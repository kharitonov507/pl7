from pathlib import Path
import html
import re
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, LongTable, TableStyle, PageBreak
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / 'DOOH-Lab-полный-отчёт.md'
OUTPUT = ROOT.parent / 'output' / 'pdf' / 'DOOH-Lab-полный-отчёт.pdf'
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Report', 'C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ReportBold', 'C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Report', normal='Report', bold='ReportBold', italic='Report', boldItalic='ReportBold')
W,H=A4
M=53
CONTENT=W-2*M
styles={
 'body':ParagraphStyle('Body',fontName='Report',fontSize=10.6,leading=14.8,spaceAfter=7.5,textColor=colors.black,splitLongWords=True,allowWidows=0,allowOrphans=0),
 'title':ParagraphStyle('Title',fontName='ReportBold',fontSize=24,leading=29,spaceAfter=17,textColor=colors.black,keepWithNext=True),
 'h1':ParagraphStyle('Heading1',fontName='ReportBold',fontSize=15.5,leading=20,spaceBefore=15,spaceAfter=9,textColor=colors.black,keepWithNext=True),
 'h2':ParagraphStyle('Heading2',fontName='ReportBold',fontSize=12,leading=16.5,spaceBefore=10,spaceAfter=7,textColor=colors.black,keepWithNext=True),
 'cell':ParagraphStyle('Cell',fontName='Report',fontSize=9.5,leading=12.7,spaceAfter=0,textColor=colors.black,splitLongWords=True),
 'header':ParagraphStyle('Header',fontName='ReportBold',fontSize=9.5,leading=12.7,spaceAfter=0,textColor=colors.white,splitLongWords=True),
 'toc':ParagraphStyle('TOC',fontName='Report',fontSize=10.3,leading=14.7,spaceBefore=0,spaceAfter=0,leftIndent=0,firstLineIndent=0),
 'list':ParagraphStyle('List',fontName='Report',fontSize=10.6,leading=14.8,spaceAfter=5,leftIndent=14,firstLineIndent=-14,textColor=colors.black,allowWidows=0,allowOrphans=0),
}

def text(value):
 value=html.escape(value).replace('`','')
 # Wrappable long filenames and URLs remain intact when copied from the Markdown source.
 return re.sub(r'([/_?=&])',r'\1<wbr/>',value)

def para(value,style='body'):
 # ReportLab does not implement HTML wbr; splitLongWords handles the source strings.
 return Paragraph(text(value).replace('<wbr/>',''),styles[style])

class ReportDoc(BaseDocTemplate):
 def afterFlowable(self,flowable):
  if isinstance(flowable,Paragraph) and flowable.style.name=='Heading1':
   title=flowable.getPlainText(); key='s'+re.match(r'\d+',title).group() if re.match(r'\d+',title) else 'contents'
   self.canv.bookmarkPage(key)
   if key!='contents':
    self.canv.addOutlineEntry(title,key,level=0,closed=False)
    self.notify('TOCEntry',(0,title,self.page,key))

def footer(canvas,doc):
 canvas.saveState();canvas.setFont('Report',8.3);canvas.setFillColor(colors.HexColor('#535B65'))
 canvas.drawString(M,31,'DOOH Lab   Отчёт о разработке   17 сентября 2026')
 canvas.drawRightString(W-M,31,str(doc.page));canvas.restoreState()

def table(block):
 rows=[[c.strip() for c in line.strip().strip('|').split('|')] for line in block]
 rows=[row for row in rows if not all(re.fullmatch(r':?-+:?',c.replace(' ','')) for c in row)]
 n=len(rows[0]); header=rows[0]
 if n==2: widths=[CONTENT*.35,CONTENT*.65]
 elif n==3:
  widths=[CONTENT*.42,CONTENT*.29,CONTENT*.29] if 'Проверка' in header[0] else [CONTENT*.26,CONTENT*.39,CONTENT*.35]
 else: widths=[CONTENT*.18,CONTENT*.33,CONTENT*.28,CONTENT*.21]
 if header[0]=='Метод': widths=[CONTENT*.13,CONTENT*.38,CONTENT*.32,CONTENT*.17] if n==4 else [CONTENT*.14,CONTENT*.43,CONTENT*.43]
 if header[0]=='Файл': widths=[CONTENT*.45,CONTENT*.55]
 if header[0]=='Параметр config': widths=[CONTENT*.32,CONTENT*.31,CONTENT*.37]
 data=[[para(c,'header' if i==0 else 'cell') for c in row] for i,row in enumerate(rows)]
 result=LongTable(data,colWidths=widths,repeatRows=1,hAlign='LEFT',splitByRow=1)
 rules=[('BACKGROUND',(0,0),(-1,0),colors.HexColor('#23354B')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#D9D9D9')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]
 for i in range(1,len(rows)):
  if i%2==0:rules.append(('BACKGROUND',(0,i),(-1,i),colors.HexColor('#F2F5F8')))
 result.setStyle(TableStyle(rules));return [Spacer(1,4),result,Spacer(1,11)]

source=SOURCE.read_text(encoding='utf-8').splitlines()
story=[];i=0;inserted_contents=False
while i<len(source):
 line=source[i].strip()
 if not line:i+=1;continue
 if line.startswith('|'):
  block=[]
  while i<len(source) and source[i].strip().startswith('|'):block.append(source[i]);i+=1
  story.extend(table(block));continue
 if line.startswith('# '):story.append(para(line[2:],'title'));i+=1;continue
 if line.startswith('## '):
  if line.startswith('## 2 ') and not inserted_contents:
   story.append(PageBreak());story.append(para('Содержание','h1'));toc=TableOfContents();toc.levelStyles=[styles['toc']];story.append(toc);story.append(PageBreak());inserted_contents=True
  story.append(para(line[3:],'h1'));i+=1;continue
 if line.startswith('### '):story.append(para(line[4:],'h2'));i+=1;continue
 if line.startswith('- '):story.append(para('• '+line[2:],'list'));i+=1;continue
 if re.match(r'^\d+\. ',line):story.append(para(line,'list'));i+=1;continue
 block=[line];i+=1
 while i<len(source) and source[i].strip() and not source[i].strip().startswith(('#','|','- ')) and not re.match(r'^\d+\. ',source[i].strip()):block.append(source[i].strip());i+=1
 story.append(para(' '.join(block)))

doc=ReportDoc(str(OUTPUT),pagesize=A4,leftMargin=M,rightMargin=M,topMargin=49,bottomMargin=50,title='DOOH Lab Подробный отчёт о разработке прототипа',author='DOOH Lab',subject='Этапы 0.1 и 0.2 архитектура реализация эксплуатация проверки и ограничения')
doc.addPageTemplates(PageTemplate(id='Report',frames=[Frame(M,50,CONTENT,H-99,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=footer))
doc.multiBuild(story)
reader=PdfReader(str(OUTPUT))
extracted='\n'.join(page.extract_text() or '' for page in reader.pages)
for required in ['30 Итог','16/16','17/17','чёрным','Astra','OTA','AGPL']:
 if required not in extracted:raise RuntimeError('Missing report content: '+required)
print('Created',OUTPUT,'pages',len(reader.pages),'source words',len(SOURCE.read_text(encoding='utf-8').split()))
