Attribute VB_Name = "RxMail"
Option Explicit

Private Const FIRST_MAIL_ROW As Long = 11
Private Running As Boolean

Public Sub OpenAllEmails()
    Dim sheet As Worksheet, outlook As Object
    Dim row As Long, lastRow As Long, opened As Long, failed As Long, skipped As Long
    Dim reason As String, previousCancel As Long, cancelled As Boolean
    If Running Then Exit Sub
    On Error GoTo StopBatch
    Set sheet = ThisWorkbook.Worksheets("Emails")
    lastRow = sheet.Cells(sheet.Rows.Count, 8).End(xlUp).Row
    If lastRow < FIRST_MAIL_ROW Then
        MsgBox "This workbook contains no prepared emails.", vbInformation, "Rx Mail Studio"
        Exit Sub
    End If
    Running = True
    previousCancel = Application.EnableCancelKey
    Application.EnableCancelKey = xlErrorHandler
    Set outlook = CreateObject("Outlook.Application")
    For row = FIRST_MAIL_ROW To lastRow
        If CStr(sheet.Cells(row, 6).Value2) = "Opened" Then
            skipped = skipped + 1
        Else
            Application.StatusBar = "Opening email " & (row - FIRST_MAIL_ROW + 1) & " of " & (lastRow - FIRST_MAIL_ROW + 1)
            reason = vbNullString
            If OpenOneEmail(outlook, sheet, row, reason) Then
                sheet.Cells(row, 6).Value2 = "Opened"
                sheet.Cells(row, 7).Value2 = "Opened " & Format$(Now, "yyyy-mm-dd hh:nn:ss")
                opened = opened + 1
            Else
                sheet.Cells(row, 6).Value2 = "Failed"
                sheet.Cells(row, 7).Value2 = reason
                failed = failed + 1
                If reason = "Opening cancelled." Then cancelled = True: Exit For
            End If
        End If
        DoEvents
    Next row
    GoTo Finished
StopBatch:
    reason = Err.Description
    If Err.Number = 18 Then
        cancelled = True
    Else
        MsgBox "Unable to continue: " & reason & vbCrLf & "Use Windows with Classic Outlook and a configured mail account. New Outlook does not support this button.", vbExclamation, "Rx Mail Studio"
    End If
Finished:
    Application.StatusBar = False
    If Running Then Application.EnableCancelKey = previousCancel
    Running = False
    Set outlook = Nothing
    If Not sheet Is Nothing Then
        MsgBox opened & " emails opened; " & failed & " failed; " & skipped & " already opened." & vbCrLf & _
            IIf(cancelled, "Opening stopped. ", "") & "Click the button again to retry only remaining rows." & vbCrLf & _
            "Review and send in Outlook. Save this Excel workbook to retain its opening status.", vbInformation, "Rx Mail Studio"
    End If
End Sub

Private Function OpenOneEmail(ByVal outlook As Object, ByVal sheet As Worksheet, ByVal row As Long, ByRef reason As String) As Boolean
    Dim item As Object, recipient As Object, addresses As Variant, address As Variant
    Dim html As String, toAddress As String, ccAddress As String
    Dim displayed As Boolean
    On Error GoTo Failed
    html = ReadBody(sheet, row)
    toAddress = Trim$(CStr(sheet.Cells(row, 3).Value2))
    If Not ValidAddress(toAddress) Then Err.Raise vbObjectError + 2101, , "Invalid To address."
    Set item = outlook.CreateItem(0)
    Set recipient = item.Recipients.Add(toAddress)
    recipient.Type = 1
    ccAddress = Trim$(CStr(sheet.Cells(row, 4).Value2))
    If Len(ccAddress) > 0 Then
        addresses = Split(ccAddress, ";")
        For Each address In addresses
            address = Trim$(CStr(address))
            If Not ValidAddress(CStr(address)) Then Err.Raise vbObjectError + 2102, , "Invalid CC address."
            Set recipient = item.Recipients.Add(CStr(address))
            recipient.Type = 2
        Next address
    End If
    If Not item.Recipients.ResolveAll Then Err.Raise vbObjectError + 2103, , "Outlook could not resolve a recipient. Check To and CC."
    item.Subject = CStr(sheet.Cells(row, 5).Value2)
    item.BodyFormat = 2
    item.HTMLBody = html
    item.Display False
    displayed = True
    ' Record immediately after Display, before cancellation can run at DoEvents.
    sheet.Cells(row, 6).Value2 = "Opened"
    OpenOneEmail = True
    Set item = Nothing
    Exit Function
Failed:
    If displayed Then
        OpenOneEmail = True
    Else
        If Err.Number = 18 Then reason = "Opening cancelled." Else reason = Err.Description
        On Error Resume Next
        If Not item Is Nothing Then item.Close 1 ' olDiscard for a message that never displayed.
    End If
    Set item = Nothing
End Function

Private Function ReadBody(ByVal sheet As Worksheet, ByVal row As Long) As String
    Dim bodies As Worksheet, first As Long, count As Long, index As Long
    Dim parts() As String, id As String, expected As Long
    Set bodies = ThisWorkbook.Worksheets("Email bodies")
    first = CLng(sheet.Cells(row, 9).Value2)
    count = CLng(sheet.Cells(row, 10).Value2)
    expected = CLng(sheet.Cells(row, 11).Value2)
    id = CStr(sheet.Cells(row, 8).Value2)
    If first < 2 Or count < 1 Or first + count - 1 > bodies.Rows.Count Then Err.Raise vbObjectError + 2110, , "Email body storage is invalid. Download this batch again."
    ReDim parts(0 To count - 1)
    For index = 0 To count - 1
        If CStr(bodies.Cells(first + index, 1).Value2) <> id Or CLng(bodies.Cells(first + index, 2).Value2) <> index + 1 Then Err.Raise vbObjectError + 2111, , "Email body parts do not match this message."
        parts(index) = CStr(bodies.Cells(first + index, 3).Value2)
    Next index
    ReadBody = Join(parts, vbNullString)
    If Len(ReadBody) <> expected Or expected = 0 Then Err.Raise vbObjectError + 2112, , "Email body is incomplete. Download this batch again."
End Function

Private Function ValidAddress(ByVal value As String) As Boolean
    ValidAddress = Len(value) > 3 And InStr(2, value, "@") > 0 And _
        InStr(value, ";") = 0 And InStr(value, ",") = 0 And InStr(value, " ") = 0 And _
        InStr(value, "<") = 0 And InStr(value, ">") = 0 And InStr(value, vbCr) = 0 And InStr(value, vbLf) = 0
End Function
