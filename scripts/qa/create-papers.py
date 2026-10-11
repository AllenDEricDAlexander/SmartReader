"""Create synthetic PDFs for desktop QA; no user documents or dependencies required."""
from pathlib import Path
import shutil
import sys


def pdf_string(value):
    return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def write_pdf(path, title, subject, journal, doi, pages):
    info = f'/Title ({pdf_string(title)}) /Subject ({pdf_string(subject)})'
    if journal:
        info += f'/Author (Ada Tester; Lin Example) /Journal ({pdf_string(journal)}) /PublicationYear (2025) /DOI ({doi})'
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        f'<< /Type /Pages /Count {len(pages)} /Kids [{" ".join(f"{5 + i * 2} 0 R" for i in range(len(pages)))}] >>'.encode(),
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        f'<< {info} >>'.encode(),
    ]
    for index, lines in enumerate(pages):
        stream = ('BT /F1 11 Tf 54 740 Td 15 TL\n' + '\n'.join(f'({pdf_string(line)}) Tj T*' for line in lines) + '\nET').encode()
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {6 + index * 2} 0 R >>'.encode())
        objects.append(f'<< /Length {len(stream)} >>\nstream\n'.encode() + stream + b'\nendstream')
    data = bytearray(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    offsets = [0]
    for index, body in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f'{index} 0 obj\n'.encode() + body + b'\nendobj\n')
    xref = len(data)
    data.extend(f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        data.extend(f'{offset:010} 00000 n \n'.encode())
    data.extend(f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    path.write_bytes(data)


destination = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/smartreader-qa-papers')
destination.mkdir(parents=True, exist_ok=True)
write_pdf(destination / 'attention-study.pdf', 'Neural mechanisms of attention and memory', 'Attention and memory', 'Journal of QA Neuroscience', '10.5555/smartreader.qa.001', [
    ['Neural mechanisms of attention and memory', 'Synthetic SmartReader QA document - not a published paper.', 'Journal: Journal of QA Neuroscience', 'Published: 2025', 'DOI: 10.5555/smartreader.qa.001', '', 'Abstract', 'This synthetic study explores how attention supports working memory.', 'Cognitive mechanisms connect focused reading with later recall.', 'Keywords: attention; working memory; learning', '', '1 Introduction', 'All names and results in this file are test fixtures.'],
    ['2 Methods', 'Participants in this fictional protocol read three passages.', 'The baseline condition uses a simple sustained attention exercise.', 'Bookmark this page to verify independent reading navigation.', '', '3 Results', 'The distinctive retrieval phrase is hippocampal consolidation.', 'Working memory improves when distraction is reduced.'],
    ['4 Discussion', 'Attention and memory support scientific reading.', 'This page is used to verify progress persistence and page navigation.', '5 Conclusion', 'All conclusions here are synthetic and must not be used as evidence.'],
])
write_pdf(destination / 'education-study.pdf', 'Feedback and learning in education', 'Educational feedback', 'Journal of QA Education', '10.5555/smartreader.qa.002', [
    ['Feedback and learning in education', 'Synthetic SmartReader QA document - not a published paper.', 'Journal: Journal of QA Education', 'Published: 2025', 'DOI: 10.5555/smartreader.qa.002', '', 'Abstract', 'This synthetic article examines feedback and learning in classrooms.', 'Keywords: education; feedback; learning', '', '1 Introduction', 'The records in this document exist only for UI testing.'],
    ['2 Findings', 'Formative feedback helps a fictional learner revise an explanation.', 'The second paper enables side-by-side comparison.'],
])
write_pdf(destination / 'preprint-study.pdf', 'An uncatalogued research preprint', 'Preprint methods', '', '', [
    ['An uncatalogued research preprint', 'Synthetic SmartReader QA document with incomplete metadata.', '', 'Abstract', 'A preprint without author, journal, year, or DOI information.', 'Use the metadata editor to supplement these fields permanently.', 'Keywords: preprint; reproducibility'],
])
shutil.copyfile(destination / 'attention-study.pdf', destination / 'attention-copy.pdf')
print(f'Created 4 synthetic PDFs (3 unique documents) in {destination}')
