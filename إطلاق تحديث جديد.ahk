#Requires AutoHotkey v2.0

; مسار المشروع
ProjectPath := "c:\My App\injaz v2"

if MsgBox("هل تريد تحديث الإصدار ورفع التحديث إلى GitHub بدون بناء؟", "إطلاق تحديث جديد", "YesNo") = "No"
    return

; التوكن الخاص بك
GhToken := "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"

; تشغيل الأوامر في سطر الأوامر
; 1. الانتقال لمجلد المشروع
; حذف ملفات exe والـ blockmap القديمة لتوفير المساحة
FileDelete(ProjectPath "\dist\*.exe")
FileDelete(ProjectPath "\dist\*.blockmap")

RunWait("cmd.exe /c `"cd /d `"" ProjectPath "`" && npm --no-git-tag-version version patch && set GH_TOKEN=" GhToken " && npx electron-builder --publish always & pause`"")

; فتح صفحة Releases على GitHub
Run("https://github.com/ost101999/Injaz/releases")

MsgBox("تمت العملية بنجاح! تم تحديث الإصدار ورفع التحديث إلى GitHub. تم فتح صفحة Releases لتتمكن من نشره.", "تم بنجاح")
