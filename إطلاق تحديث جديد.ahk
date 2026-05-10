#Requires AutoHotkey v2.0

; مسار المشروع ثابت ليعمل الملف من أي مكان
ProjectPath := "c:\My App\injaz v2"

if MsgBox("هل تريد تحديث الإصدار ورفعه إلى GitHub تلقائياً؟", "إطلاق تحديث جديد", "YesNo") = "No"
    return

; تشغيل الأوامر في سطر الأوامر
; 1. الانتقال لمجلد المشروع
; 2. رفع رقم الإصدار (Patch)
; 3. إضافة كل التغييرات
; 4. عمل Commit
; 5. الرفع إلى GitHub
RunWait("cmd.exe /c `"cd /d `"" ProjectPath "`" && npm --no-git-tag-version version patch && git add . && git commit -m `"chore: release new version`" && git push origin main & pause`"")

MsgBox("تم تحديث الإصدار ورفع الكود بنجاح! راجع صفحة Actions على GitHub لمتابعة البناء.", "تم بنجاح")
