/**
 * General certificate (bonafide, character …). Reads `/data.json` (see `CertificatePdfData`)
 * and `/logo.png` when `data.hasLogo`. The body is plain text, never Typst source.
 */
export const CERTIFICATE_TEMPLATE = String.raw`
#let d = json("/data.json")
#set document(title: d.title + " " + d.serial)
#set page(paper: "a4", margin: (x: 2.2cm, top: 2cm, bottom: 2.2cm))
#set text(font: ("Noto Sans", "Noto Sans Devanagari"), size: 11.5pt, fallback: false)
#set par(leading: 0.9em, justify: true)

#grid(
  columns: (2.2cm, 1fr, 2.2cm),
  align: (left + horizon, center + horizon, right + horizon),
  if d.hasLogo { image("/logo.png", height: 2cm, fit: "contain") },
  [
    #text(size: 17pt, weight: "bold")[#d.institute.name] \
    #if d.institute.address != none [#text(size: 9pt)[#d.institute.address] \ ]
    #if d.institute.affiliation != none [#text(size: 9pt)[#d.institute.affiliation]]
  ],
  [],
)
#v(2pt)
#line(length: 100%, stroke: 0.8pt)
#v(6pt)
#grid(
  columns: (1fr, 1fr),
  align: (left, right),
  [*No.:* #d.serial],
  [*Date:* #d.issuedOn],
)
#v(1cm)
#align(center, text(size: 15pt, weight: "bold", tracking: 1pt)[#upper(d.title)])
#v(0.8cm)
#for paragraph in d.body [
  #paragraph

]
#v(1fr)
#align(right)[
  #v(1.5cm)
  Principal (signature and seal)
]
`;
