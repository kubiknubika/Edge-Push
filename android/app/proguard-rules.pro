# КРАЙ / Edge Push
# R8 выключен для release: HTML/CSS/JS/PNG/JSON загружаются по именам из assets.
# Правила оставлены на случай, если минификация будет включена позже.
-keep class com.kubiknubika.edgepush.** { *; }
-dontwarn androidx.webkit.**
-keepattributes *Annotation*
