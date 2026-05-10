#Requires AutoHotkey v2.0

; مسار المشروع
ProjectPath := "c:\My App\injaz v2"

if MsgBox("هل تريد تحديث الإصدار ورفع التحديث إلى GitHub بدون بناء؟", "إطلاق تحديث جديد", "YesNo") = "No"
    return

; التوكن الخاص بك
GhToken := "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"

; تشغيل الأوامر في سطر الأوامر
; 1. الانتقال لمجلد المشروع
; 2. رفع رقم الإصدار (Patch) تلقائياً في package.json
; 3. إعطاء الصلاحية عن طريق ضبط المتغير البيئي GH_TOKEN
; 4. تشغيل أمر البناء والرفع (npm run release)
RunWait("cmd.exe /c `"cd /d `"" ProjectPath "`" && npm --no-git-tag-version version patch && set GH_TOKEN=" GhToken " && npx electron-builder --publish always & pause`"")

MsgBox("تمت العملية بنجاح! تم تحديث الإصدار وبناء التطبيق ورفعه إلى GitHub.", "تم بنجاح")
