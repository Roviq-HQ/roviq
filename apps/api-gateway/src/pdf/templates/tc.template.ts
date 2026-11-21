/**
 * Transfer certificate. Reads `/data.json` (see `TcPdfData`), `/qr.svg`, and `/logo.png` when
 * `data.hasLogo`. Values are data, never Typst source.
 */
export const TC_TEMPLATE = String.raw`
#let d = json("/data.json")
#set document(title: "Transfer Certificate " + d.serial)
#set page(
  paper: "a4",
  margin: (x: 1.6cm, top: 1.4cm, bottom: 1.6cm),
  background: if d.isDuplicate {
    rotate(-35deg, text(size: 90pt, weight: "bold", fill: rgb(0, 0, 0, 14))[DUPLICATE])
  },
)
#set text(font: ("Noto Sans", "Noto Sans Devanagari"), size: 9.5pt, fallback: false)
#set par(leading: 0.5em)

#grid(
  columns: (2.2cm, 1fr, 2.2cm),
  align: (left + horizon, center + horizon, right + horizon),
  if d.hasLogo { image("/logo.png", height: 2cm, fit: "contain") },
  [
    #text(size: 16pt, weight: "bold")[#d.institute.name] \
    #if d.institute.address != none [#text(size: 8.5pt)[#d.institute.address] \ ]
    #if d.institute.affiliation != none [#text(size: 8.5pt)[#d.institute.affiliation]]
  ],
  [],
)
#v(2pt)
#line(length: 100%, stroke: 0.8pt)
#align(center)[
  #text(size: 13pt, weight: "bold", tracking: 1pt)[TRANSFER CERTIFICATE]
  #if d.isDuplicate [ \ #text(size: 10pt, weight: "bold")[DUPLICATE COPY #if d.originalSerial != none [of #d.originalSerial]]]
]
#grid(
  columns: (1fr, 1fr),
  align: (left, right),
  [*TC No.:* #d.serial],
  [*Admission No.:* #d.admissionNumber],
)
#v(4pt)
#table(
  columns: (0.9cm, 7.6cm, 1fr),
  stroke: 0.4pt + rgb(120, 120, 120),
  inset: (x: 5pt, y: 4.2pt),
  ..d.fields.map(f => (f.no, f.label, text(weight: "bold")[#f.value])).flatten()
)
#v(1fr)
#grid(
  columns: (1fr, 1fr, 1fr),
  align: (left + bottom, center + bottom, right + bottom),
  [#v(1.2cm) Prepared by],
  [#v(1.2cm) Checked by],
  [#v(1.2cm) Principal (signature and seal)],
)
#v(8pt)
#line(length: 100%, stroke: 0.4pt)
#grid(
  columns: (2.3cm, 1fr),
  gutter: 8pt,
  align: (left + horizon, left + horizon),
  image("/qr.svg", width: 2.1cm),
  text(size: 8pt)[
    Scan the code to check this certificate, or open \
    #d.verifyUrl \
    Issued on #d.issuedOn.
  ],
)
`;
