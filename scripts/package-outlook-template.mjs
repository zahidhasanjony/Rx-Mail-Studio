// Adds VBA and a Forms button, native features outside the artifact worksheet API.
import fs from 'node:fs';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';

const files = unzipSync(fs.readFileSync(process.argv[2]));
const change = (path, fn) => files[path] = strToU8(fn(strFromU8(files[path])));
const relationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
change('[Content_Types].xml', xml => xml.replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml', 'application/vnd.ms-excel.sheet.macroEnabled.main+xml').replace('</Types>', '<Override PartName="/xl/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/></Types>'));
change('xl/workbook.xml', xml => xml.replace('<x:sheets>', '<x:workbookPr codeName="ThisWorkbook"/><x:sheets>').replace('name="Email bodies"', 'state="veryHidden" name="Email bodies"'));
change('xl/_rels/workbook.xml.rels', xml => xml.replace('</Relationships>', '<Relationship Id="rIdVba" Type="http://schemas.microsoft.com/office/2006/relationships/vbaProject" Target="vbaProject.bin"/></Relationships>'));
for (const [i, name] of [[1, 'Sheet1'], [2, 'Sheet2']]) change(`xl/worksheets/sheet${i}.xml`, xml => xml.replace(/(<x:worksheet\b[^>]*>)/, `$1<x:sheetPr codeName="${name}"/>`));
change('xl/worksheets/sheet1.xml', xml => xml.replace(/<x:col min="([89]|10|11)"([^>]*?)hidden="0"/g, '<x:col min="$1"$2hidden="1"').replace('</x:worksheet>', '<x:legacyDrawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdButton"/></x:worksheet>'));
files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdButton" Type="${relationships}/vmlDrawing" Target="../drawings/vmlDrawing1.vml"/></Relationships>`);
files['xl/drawings/vmlDrawing1.vml'] = strToU8(`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>
<v:shapetype id="_x0000_t201" coordsize="21600,21600" o:spt="201" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path shadowok="f" o:extrusionok="f" strokeok="f" fillok="f" o:connecttype="rect"/><o:lock v:ext="edit" shapetype="t"/></v:shapetype>
<v:shape id="OpenAllEmailsButton" o:spid="_x0000_s1025" type="#_x0000_t201" style="position:absolute;margin-left:4pt;margin-top:168pt;width:250pt;height:32pt;z-index:1" fillcolor="buttonFace [67]" strokecolor="windowText [64]" o:button="t"><v:fill color2="buttonFace [67]" o:detectmouseclick="t"/><o:lock v:ext="edit" rotation="t"/>
<v:textbox style="mso-direction-alt:auto" o:singleclick="f"><div style="text-align:center"><font face="Arial" size="220" color="#17365D">Open all emails in Outlook</font></div></v:textbox>
<x:ClientData ObjectType="Button"><x:Anchor>0, 4, 7, 3, 3, 48, 8, 23</x:Anchor><x:PrintObject>False</x:PrintObject><x:AutoFill>False</x:AutoFill><x:FmlaMacro>[0]!OpenAllEmails</x:FmlaMacro><x:TextHAlign>Center</x:TextHAlign><x:TextVAlign>Center</x:TextVAlign></x:ClientData></v:shape></xml>`);
files['xl/vbaProject.bin'] = new Uint8Array(fs.readFileSync(process.argv[3]));
fs.writeFileSync(process.argv[4], zipSync(files));
console.log(`Saved ${process.argv[4]}`);
