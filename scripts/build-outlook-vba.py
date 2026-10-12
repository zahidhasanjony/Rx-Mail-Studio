"""Build a source-only MS-OVBA project from the reviewed VBA module.

CFB v3 serialization and OVBA compression use no Office automation.
The seed is used only to preserve standard Excel/VBA typelib references.
"""
from pathlib import Path
import struct
import sys
import json
import base64

FREE, END, FAT, NONE = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF

def read_cfb(data):
    size = 1 << struct.unpack_from('<H', data, 30)[0]
    sector = lambda i: data[(i + 1) * size:(i + 2) * size]
    fat_ids = [i for i in struct.unpack_from('<109I', data, 76) if i != FREE]
    fat = [i for s in fat_ids for i in struct.unpack('<' + 'I' * (size // 4), sector(s))]
    def chain(start, table=fat, chunk=sector):
        out = b''
        seen = set()
        while start not in (END, FREE):
            if start in seen: raise ValueError('CFB cycle')
            seen.add(start)
            out += chunk(start)
            start = table[start]
        return out
    directory = chain(struct.unpack_from('<I', data, 48)[0])
    entries = []
    for offset in range(0, len(directory), 128):
        raw = directory[offset:offset + 128]
        length = struct.unpack_from('<H', raw, 64)[0]
        entries.append(dict(name=raw[:max(0, length - 2)].decode('utf-16le'), type=raw[66],
                            left=struct.unpack_from('<I', raw, 68)[0], right=struct.unpack_from('<I', raw, 72)[0],
                            child=struct.unpack_from('<I', raw, 76)[0], start=struct.unpack_from('<I', raw, 116)[0],
                            size=struct.unpack_from('<Q', raw, 120)[0]))
    mini = chain(entries[0]['start'])[:entries[0]['size']]
    mini_fat_raw = chain(struct.unpack_from('<I', data, 60)[0])
    mini_fat = list(struct.unpack('<' + 'I' * (len(mini_fat_raw) // 4), mini_fat_raw))
    streams = {}
    def walk(i, prefix=''):
        if i == NONE: return
        e = entries[i]
        walk(e['left'], prefix)
        path = prefix + e['name']
        if e['type'] == 1: walk(e['child'], path + '/')
        elif e['type'] == 2:
            streams[path] = (chain(e['start'], mini_fat, lambda j: mini[j * 64:(j + 1) * 64]) if e['size'] < 4096 else chain(e['start']))[:e['size']]
        walk(e['right'], prefix)
    walk(entries[0]['child'])
    return streams

def decompress(data):
    assert data[0] == 1
    result = bytearray()
    pos = 1
    while pos < len(data):
        header = struct.unpack_from('<H', data, pos)[0]
        stop = min(len(data), pos + (header & 0xFFF) + 3)
        pos += 2
        start = len(result)
        if not header & 0x8000:
            result.extend(data[pos:stop]); pos = stop; continue
        while pos < stop:
            flags = data[pos]; pos += 1
            for bit in range(8):
                if pos >= stop: break
                if flags & (1 << bit):
                    token = struct.unpack_from('<H', data, pos)[0]; pos += 2
                    bits = max(4, (len(result) - start - 1).bit_length())
                    length = (token & (0xFFFF >> bits)) + 3
                    distance = (token >> (16 - bits)) + 1
                    for _ in range(length): result.append(result[-distance])
                else: result.append(data[pos]); pos += 1
    return bytes(result)

def compress(data):
    result = bytearray(b'\x01')
    for start in range(0, len(data), 4096):
        block = data[start:start + 4096]
        payload = bytearray(); pos = 0
        while pos < len(block):
            flag_pos = len(payload); payload.append(0)
            for bit in range(8):
                if pos >= len(block): break
                bits = max(4, (pos - 1).bit_length())
                maximum = min((0xFFFF >> bits) + 3, len(block) - pos)
                best_len = 0; best_distance = 0
                if maximum >= 3:
                    candidate = block.rfind(block[pos:pos + 3], max(0, pos - (1 << bits)), pos)
                    while candidate >= max(0, pos - (1 << bits)):
                        length = 3
                        while length < maximum and block[candidate + length] == block[pos + length]: length += 1
                        if length > best_len: best_len, best_distance = length, pos - candidate
                        if length == maximum: break
                        candidate = block.rfind(block[pos:pos + 3], max(0, pos - (1 << bits)), candidate)
                if best_len >= 3:
                    payload[flag_pos] |= 1 << bit
                    payload.extend(struct.pack('<H', ((best_distance - 1) << (16 - bits)) | (best_len - 3)))
                    pos += best_len
                else: payload.append(block[pos]); pos += 1
        if len(payload) >= 4096:
            if len(block) != 4096: raise ValueError('Incompressible partial OVBA chunk')
            result.extend(struct.pack('<H', 0x3FFF)); result.extend(block)
        else:
            result.extend(struct.pack('<H', 0xB000 | (len(payload) - 1)))
            result.extend(payload)
    return bytes(result)

def write_cfb(streams):
    nodes = [dict(name='Root Entry', type=5, child=NONE, left=NONE, right=NONE, color=1, start=END, size=0)]
    ids = {'': 0}
    for path in streams:
        for prefix in [path.split('/')[0]] if '/' in path else []:
            if prefix not in ids:
                ids[prefix] = len(nodes)
                nodes.append(dict(name=prefix, type=1, child=NONE, left=NONE, right=NONE, color=1, start=END, size=0))
        ids[path] = len(nodes)
        nodes.append(dict(name=path.split('/')[-1], type=2, child=NONE, left=NONE, right=NONE, color=1, start=END, size=len(streams[path])))
    # Red-black directory search trees, ordered by CFB name length then uppercase.
    for parent in [p for p, i in ids.items() if nodes[i]['type'] != 2]:
        children = [i for p, i in ids.items() if p and p.rpartition('/')[0] == parent]
        children.sort(key=lambda i: (len(nodes[i]['name']), nodes[i]['name'].upper()))
        red_level = 0; n = len(children) - 1
        while n >= 0: red_level += 1; n = n // 2 - 1
        def tree(lo, hi, level=0):
            if lo > hi: return NONE
            mid = (lo + hi) // 2; idx = children[mid]
            nodes[idx]['color'] = 0 if level == red_level else 1
            nodes[idx]['left'] = tree(lo, mid - 1, level + 1)
            nodes[idx]['right'] = tree(mid + 1, hi, level + 1)
            return idx
        nodes[ids[parent]]['child'] = tree(0, len(children) - 1)
    sectors, fat, mini, mini_fat = [], [], bytearray(), []
    def allocate(data):
        start = len(sectors)
        count = (len(data) + 511) // 512
        for i in range(count):
            sectors.append(data[i * 512:(i + 1) * 512].ljust(512, b'\0'))
            fat.append(start + i + 1 if i + 1 < count else END)
        return start if count else END
    for path, data in streams.items():
        node = nodes[ids[path]]
        if len(data) < 4096:
            node['start'] = len(mini_fat) if data else END
            count = (len(data) + 63) // 64
            for i in range(count):
                mini.extend(data[i * 64:(i + 1) * 64].ljust(64, b'\0'))
                mini_fat.append(len(mini_fat) + 1 if i + 1 < count else END)
        else: node['start'] = allocate(data)
    nodes[0]['start'], nodes[0]['size'] = allocate(mini), len(mini)
    mini_fat_start = allocate(b''.join(struct.pack('<I', x) for x in mini_fat).ljust(((len(mini_fat) + 127) // 128) * 512, b'\xff'))
    directory = bytearray()
    for node in nodes:
        raw = bytearray(128); name = (node['name'] + '\0').encode('utf-16le')
        raw[:len(name)] = name
        struct.pack_into('<HBBIII', raw, 64, len(name), node['type'], node['color'], node['left'], node['right'], node['child'])
        struct.pack_into('<IQ', raw, 116, node['start'], node['size'])
        directory.extend(raw)
    dir_start = allocate(directory)
    fat_count = 1
    while fat_count * 128 < len(sectors) + fat_count: fat_count += 1
    if fat_count > 109: raise ValueError('Project exceeds supported CFB size')
    fat_ids = list(range(len(sectors), len(sectors) + fat_count))
    fat.extend([FAT] * fat_count)
    fat.extend([FREE] * (fat_count * 128 - len(fat)))
    fat_raw = b''.join(struct.pack('<I', x) for x in fat)
    sectors.extend(fat_raw[i * 512:(i + 1) * 512] for i in range(fat_count))
    header = bytearray(512)
    header[:8] = bytes.fromhex('D0CF11E0A1B11AE1')
    struct.pack_into('<HHHHH', header, 24, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into('<IIIIIIIII', header, 40, 0, fat_count, dir_start, 0, 4096, mini_fat_start, (len(mini_fat) + 127) // 128, END, 0)
    struct.pack_into('<109I', header, 76, *(fat_ids + [FREE] * (109 - fat_count)))
    return bytes(header) + b''.join(sectors)

if __name__ == '__main__':
    if Path(sys.argv[1]).suffix == '.json':
        metadata = json.loads(Path(sys.argv[1]).read_text())
        information = base64.b64decode(metadata['information'])
    else:
        seed = read_cfb(Path(sys.argv[1]).read_bytes())
        original_dir = decompress(seed['VBA/dir'])
        module_start = original_dir.index(struct.pack('<HI', 0xF, 2))
        information = original_dir[:module_start]
        project = seed['PROJECT'].decode('cp1252')
        metadata = {key: next(line for line in project.splitlines() if line.startswith(key + '=')) for key in ['ID', 'CMG', 'DPB', 'GC']}
    if len(sys.argv) == 2:
        print({p: len(v) for p, v in seed.items()})
        print(seed['PROJECT'].decode('cp1252'))
        Path('/tmp/rxmail-seed-dir.bin').write_bytes(decompress(seed['VBA/dir']))
        sys.exit()
    # Keep the original, Office-produced information + reference records only.
    rec = lambda ident, payload: struct.pack('<HI', ident, len(payload)) + payload
    information = information.replace(rec(0x4, b'VBAProject'), rec(0x4, b'RxMailStudio'))
    modules = {
        'ThisWorkbook': 'Attribute VB_Name = "ThisWorkbook"\r\nAttribute VB_Base = "0{00020819-0000-0000-C000-000000000046}"\r\nAttribute VB_GlobalNameSpace = False\r\nAttribute VB_Creatable = False\r\nAttribute VB_PredeclaredId = True\r\nAttribute VB_Exposed = True\r\n',
        'Sheet1': 'Attribute VB_Name = "Sheet1"\r\nAttribute VB_Base = "0{00020820-0000-0000-C000-000000000046}"\r\nAttribute VB_GlobalNameSpace = False\r\nAttribute VB_Creatable = False\r\nAttribute VB_PredeclaredId = True\r\nAttribute VB_Exposed = True\r\n',
        'Sheet2': 'Attribute VB_Name = "Sheet2"\r\nAttribute VB_Base = "0{00020820-0000-0000-C000-000000000046}"\r\nAttribute VB_GlobalNameSpace = False\r\nAttribute VB_Creatable = False\r\nAttribute VB_PredeclaredId = True\r\nAttribute VB_Exposed = True\r\n',
        'RxMail': Path(sys.argv[2]).read_text().replace('\r\n', '\n').replace('\n', '\r\n'),
    }
    records = information + rec(0xF, struct.pack('<H', len(modules))) + rec(0x13, b'\xff\xff')
    streams = {}
    for name, source in modules.items():
        encoded = name.encode('cp1252'); wide = name.encode('utf-16le')
        records += rec(0x19, encoded) + rec(0x47, wide) + rec(0x1A, encoded) + rec(0x32, wide)
        records += rec(0x1C, b'') + rec(0x48, b'') + rec(0x31, struct.pack('<I', 0))
        records += rec(0x1E, struct.pack('<I', 0)) + rec(0x2C, b'\xff\xff')
        records += rec(0x21 if name == 'RxMail' else 0x22, b'') + rec(0x2B, b'')
        streams['VBA/' + name] = compress(source.encode('cp1252'))
        assert decompress(streams['VBA/' + name]).decode('cp1252') == source
    records += rec(0x10, b'')
    streams['VBA/dir'] = compress(records)
    streams['VBA/_VBA_PROJECT'] = bytes.fromhex('CC61FFFF000100')
    streams['PROJECT'] = (metadata['ID'] + '\r\nDocument=ThisWorkbook/&H00000000\r\nDocument=Sheet1/&H00000000\r\nDocument=Sheet2/&H00000000\r\nModule=RxMail\r\nName="RxMailStudio"\r\nHelpContextID="0"\r\nVersionCompatible32="393222000"\r\n' + '\r\n'.join(metadata[k] for k in ['CMG', 'DPB', 'GC']) + '\r\n\r\n[Host Extender Info]\r\n&H00000001={3832D640-CF90-11CF-8E43-00A0C911005A};VBE;&H00000000\r\n[Workspace]\r\nThisWorkbook=0, 0, 0, 0, C\r\nSheet1=0, 0, 0, 0, C\r\nSheet2=0, 0, 0, 0, C\r\nRxMail=0, 0, 0, 0, C\r\n').encode('cp1252')
    streams['PROJECTwm'] = b''.join(n.encode('cp1252') + b'\0' + (n + '\0').encode('utf-16le') for n in modules) + b'\0\0'
    result = write_cfb(streams)
    assert read_cfb(result) == streams
    Path(sys.argv[3]).write_bytes(result)
    print(f'Built {len(result)}-byte VBA project with {len(modules)} source-only modules')
