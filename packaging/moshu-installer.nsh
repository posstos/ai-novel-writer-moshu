!include "WinVer.nsh"

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Moshu requires Windows 10 or Windows 11 (64-bit)."
    Abort
  ${EndIf}
!macroend
