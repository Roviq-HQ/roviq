# PDF fonts

Noto Sans and Noto Sans Devanagari (Regular, Bold), from the Noto project, licensed under the
SIL Open Font License 1.1 (https://openfontlicense.org). `PdfService` loads every font in this
folder. To support another script, add its Noto font here, add the family to
`PDF_FONT_FAMILIES` and the script to `RENDERABLE_TEXT` in `apps/api-gateway/src/pdf/pdf.service.ts`.
