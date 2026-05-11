# Thai fonts for PDF rendering

Drop the **Sarabun** font family TTF files in this directory:

```
Sarabun-Regular.ttf
Sarabun-Bold.ttf
Sarabun-Italic.ttf
Sarabun-BoldItalic.ttf
```

The PDF renderer (`pdfmake`) auto-detects them at startup. Without these,
official meeting minutes export will fall back to Roboto and Thai text
will render as boxes.

Sarabun is the standard typeface for Thai government documents and is
distributed by Google under the Apache 2.0 license:

- https://fonts.google.com/specimen/Sarabun

DOCX export does not need the bundled font — it relies on whichever Thai
font Word/LibreOffice has installed (Calibri / TH SarabunPSK / Cordia New).
