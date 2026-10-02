from pathlib import Path
from datetime import date

from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Flowable,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "player-server-meeting-handbook.pdf"


# Palette close to the current Player Control prototype.
INK = HexColor("#172033")
MUTED = HexColor("#65708A")
PURPLE = HexColor("#7357D9")
PURPLE_DARK = HexColor("#4E3CAA")
PURPLE_LIGHT = HexColor("#EEEAFE")
CYAN = HexColor("#DDF7F4")
GREEN = HexColor("#228B72")
GREEN_LIGHT = HexColor("#E7F6F1")
AMBER = HexColor("#C47B16")
AMBER_LIGHT = HexColor("#FFF3DF")
RED = HexColor("#B4424B")
RED_LIGHT = HexColor("#FFECEE")
BLUE = HexColor("#3569B8")
BLUE_LIGHT = HexColor("#EAF2FF")
PAPER = HexColor("#F7F8FC")
LINE = HexColor("#DDE2EC")
WHITE = colors.white


def register_fonts():
    fonts = Path("C:/Windows/Fonts")
    pdfmetrics.registerFont(TTFont("Arial", str(fonts / "arial.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-Bold", str(fonts / "arialbd.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-Italic", str(fonts / "ariali.ttf")))
    pdfmetrics.registerFont(TTFont("Arial-BoldItalic", str(fonts / "arialbi.ttf")))
    pdfmetrics.registerFontFamily(
        "Arial",
        normal="Arial",
        bold="Arial-Bold",
        italic="Arial-Italic",
        boldItalic="Arial-BoldItalic",
    )


register_fonts()


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="BodyRU",
        fontName="Arial",
        fontSize=9.2,
        leading=13.2,
        textColor=INK,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        name="SmallRU",
        fontName="Arial",
        fontSize=7.7,
        leading=10.5,
        textColor=MUTED,
        spaceAfter=3,
    )
)
styles.add(
    ParagraphStyle(
        name="H1RU",
        fontName="Arial-Bold",
        fontSize=22,
        leading=25,
        textColor=INK,
        spaceBefore=4,
        spaceAfter=11,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="H2RU",
        fontName="Arial-Bold",
        fontSize=15,
        leading=18,
        textColor=INK,
        spaceBefore=8,
        spaceAfter=7,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="H3RU",
        fontName="Arial-Bold",
        fontSize=11.2,
        leading=14,
        textColor=PURPLE_DARK,
        spaceBefore=6,
        spaceAfter=4,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="Eyebrow",
        fontName="Arial-Bold",
        fontSize=7.2,
        leading=9,
        textColor=PURPLE,
        spaceAfter=4,
        uppercase=True,
        tracking=1.1,
    )
)
styles.add(
    ParagraphStyle(
        name="TitleBig",
        fontName="Arial-Bold",
        fontSize=28,
        leading=31,
        textColor=WHITE,
        alignment=TA_LEFT,
    )
)
styles.add(
    ParagraphStyle(
        name="TitleSub",
        fontName="Arial",
        fontSize=12.5,
        leading=17,
        textColor=HexColor("#E7E4FF"),
    )
)
styles.add(
    ParagraphStyle(
        name="Callout",
        fontName="Arial-Bold",
        fontSize=10.5,
        leading=14.5,
        textColor=INK,
        spaceAfter=0,
    )
)
styles.add(
    ParagraphStyle(
        name="TableHead",
        fontName="Arial-Bold",
        fontSize=7.7,
        leading=10,
        textColor=WHITE,
        alignment=TA_LEFT,
    )
)
styles.add(
    ParagraphStyle(
        name="TableCell",
        fontName="Arial",
        fontSize=7.6,
        leading=10.2,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="TableCellBold",
        fontName="Arial-Bold",
        fontSize=7.6,
        leading=10.2,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="QuoteRU",
        fontName="Arial-Italic",
        fontSize=10.2,
        leading=15,
        leftIndent=7 * mm,
        rightIndent=5 * mm,
        textColor=PURPLE_DARK,
        borderColor=PURPLE,
        borderWidth=0,
        borderPadding=0,
        spaceAfter=6,
    )
)


def P(text, style="BodyRU"):
    return Paragraph(text, styles[style])


def h1(text):
    return [P(text.upper(), "Eyebrow"), P(text, "H1RU")]


def h2(text):
    return P(text, "H2RU")


def h3(text):
    return P(text, "H3RU")


def bullets(items, checkbox=False, compact=False):
    out = []
    st = "SmallRU" if compact else "BodyRU"
    prefix = "[ ]" if checkbox else "•"
    for item in items:
        out.append(P(f"<font color='#7357D9'><b>{prefix}</b></font>&nbsp;&nbsp;{item}", st))
    return out


def numbered(items):
    out = []
    for i, item in enumerate(items, 1):
        out.append(P(f"<font color='#7357D9'><b>{i}.</b></font>&nbsp;&nbsp;{item}"))
    return out


def callout(title, text, tone="purple"):
    palette = {
        "purple": (PURPLE_LIGHT, PURPLE),
        "green": (GREEN_LIGHT, GREEN),
        "amber": (AMBER_LIGHT, AMBER),
        "red": (RED_LIGHT, RED),
        "blue": (BLUE_LIGHT, BLUE),
    }
    bg, border = palette[tone]
    data = [[P(title, "Callout")], [P(text, "BodyRU")]]
    t = Table(data, colWidths=[166 * mm], hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("BOX", (0, 0), (-1, -1), 0.8, border),
                ("LINEBEFORE", (0, 0), (0, -1), 4, border),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, 0), 8),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
                ("TOPPADDING", (0, 1), (-1, -1), 2),
            ]
        )
    )
    return KeepTogether([t, Spacer(1, 4 * mm)])


def data_table(headers, rows, widths=None, header_bg=PURPLE_DARK, font_size=7.5):
    header_cells = [P(str(v), "TableHead") for v in headers]
    body = []
    for row in rows:
        body.append([P(str(v), "TableCell") for v in row])
    t = Table([header_cells] + body, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), header_bg),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PAPER]),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return t


class ArchitectureDiagram(Flowable):
    def __init__(self, kind, width=166 * mm, height=94 * mm):
        super().__init__()
        self.kind = kind
        self.width = width
        self.height = height

    def wrap(self, availWidth, availHeight):
        return min(self.width, availWidth), self.height

    def _box(self, c, x, y, w, h, title, subtitle="", fill=WHITE, stroke=LINE, title_color=INK):
        c.setFillColor(fill)
        c.setStrokeColor(stroke)
        c.setLineWidth(1)
        c.roundRect(x, y, w, h, 5, fill=1, stroke=1)
        title_p = Paragraph(f"<b>{title}</b>", ParagraphStyle("bx", fontName="Arial-Bold", fontSize=8.5, leading=10.5, textColor=title_color, alignment=TA_CENTER))
        tw, th = title_p.wrap(w - 8, h)
        subtitle_h = 0
        if subtitle:
            sub_p = Paragraph(subtitle, ParagraphStyle("bs", fontName="Arial", fontSize=6.8, leading=8.4, textColor=MUTED, alignment=TA_CENTER))
            sw, sh = sub_p.wrap(w - 8, h)
            subtitle_h = sh + 2
        else:
            sub_p = None
        total = th + subtitle_h
        top = y + (h + total) / 2
        title_p.drawOn(c, x + 4, top - th)
        if sub_p:
            sub_p.drawOn(c, x + 4, top - th - subtitle_h)

    def _arrow(self, c, x1, y1, x2, y2, label="", dashed=False):
        c.setStrokeColor(PURPLE)
        c.setFillColor(PURPLE)
        c.setLineWidth(1.3)
        if dashed:
            c.setDash(4, 3)
        else:
            c.setDash()
        c.line(x1, y1, x2, y2)
        import math
        angle = math.atan2(y2 - y1, x2 - x1)
        size = 5
        pts = [
            (x2, y2),
            (x2 - size * math.cos(angle - 0.5), y2 - size * math.sin(angle - 0.5)),
            (x2 - size * math.cos(angle + 0.5), y2 - size * math.sin(angle + 0.5)),
        ]
        path = c.beginPath()
        path.moveTo(*pts[0])
        path.lineTo(*pts[1])
        path.lineTo(*pts[2])
        path.close()
        c.drawPath(path, fill=1, stroke=0)
        c.setDash()
        if label:
            p = Paragraph(label, ParagraphStyle("al", fontName="Arial", fontSize=6.4, leading=7.5, textColor=PURPLE_DARK, alignment=TA_CENTER, backColor=WHITE))
            pw, ph = p.wrap(abs(x2 - x1) + 24, 30)
            p.drawOn(c, (x1 + x2 - pw) / 2, (y1 + y2 - ph) / 2 + 3)

    def draw(self):
        c = self.canv
        c.setFillColor(PAPER)
        c.roundRect(0, 0, self.width, self.height, 8, fill=1, stroke=0)
        if self.kind == "platform":
            self._draw_platform(c)
        elif self.kind == "scheduler":
            self._draw_scheduler(c)
        elif self.kind == "edge":
            self._draw_edge(c)
        elif self.kind == "cv":
            self._draw_cv(c)
        elif self.kind == "sequence":
            self._draw_sequence(c)
        elif self.kind == "data":
            self._draw_data(c)

    def _draw_platform(self, c):
        w = self.width
        self._box(c, 8, 64 * mm, 43 * mm, 20 * mm, "Источники заказов", "CRM, менеджеры, онлайн, партнёры", BLUE_LIGHT, BLUE)
        self._box(c, 62 * mm, 64 * mm, 43 * mm, 20 * mm, "Инвентарь и планировщик", "бронь, приоритет, pacing, конфликты", PURPLE_LIGHT, PURPLE)
        self._box(c, 116 * mm, 64 * mm, 43 * mm, 20 * mm, "Player Server", "контент, устройства, задания, отчёты", GREEN_LIGHT, GREEN)
        self._arrow(c, 51 * mm, 74 * mm, 62 * mm, 74 * mm)
        self._arrow(c, 105 * mm, 74 * mm, 116 * mm, 74 * mm)
        self._box(c, 20 * mm, 29 * mm, 36 * mm, 20 * mm, "Go-агент", "SQLite, кеш, очередь", WHITE, PURPLE)
        self._box(c, 66 * mm, 29 * mm, 36 * mm, 20 * mm, "Chromium kiosk", "локальный рендер", WHITE, PURPLE)
        self._box(c, 112 * mm, 29 * mm, 36 * mm, 20 * mm, "LED-экран", "контроллер и полотно", WHITE, PURPLE)
        self._arrow(c, 138 * mm, 64 * mm, 38 * mm, 49 * mm, "manifest / команды")
        self._arrow(c, 56 * mm, 39 * mm, 66 * mm, 39 * mm, "HTTP + WS")
        self._arrow(c, 102 * mm, 39 * mm, 112 * mm, 39 * mm, "HDMI / DP")
        self._box(c, 34 * mm, 4 * mm, 46 * mm, 16 * mm, "Proof-of-play", "событие плеера", AMBER_LIGHT, AMBER)
        self._box(c, 92 * mm, 4 * mm, 46 * mm, 16 * mm, "Proof-of-display", "камера + CV", CYAN, GREEN)
        self._arrow(c, 38 * mm, 29 * mm, 57 * mm, 20 * mm, dashed=True)
        self._arrow(c, 130 * mm, 29 * mm, 115 * mm, 20 * mm, dashed=True)

    def _draw_scheduler(self, c):
        steps = [
            ("Заказ", "экран, период, бюджет"),
            ("Валидация", "модерация, формат, права"),
            ("Бронь", "атомарно, TTL"),
            ("План", "приоритет + pacing"),
            ("Готовность", "файлы в кеше"),
            ("Показ", "без разрыва ролика"),
            ("Сверка", "план против факта"),
        ]
        x = 7 * mm
        y = 54 * mm
        bw = 20.5 * mm
        for i, (a, b) in enumerate(steps):
            self._box(c, x, y, bw, 25 * mm, a, b, PURPLE_LIGHT if i in (2, 3) else WHITE, PURPLE)
            if i < len(steps) - 1:
                self._arrow(c, x + bw, y + 12.5 * mm, x + bw + 3 * mm, y + 12.5 * mm)
            x += bw + 3 * mm
        self._box(c, 16 * mm, 15 * mm, 38 * mm, 20 * mm, "Гарантированные", "занимают место первыми", BLUE_LIGHT, BLUE)
        self._box(c, 65 * mm, 15 * mm, 38 * mm, 20 * mm, "Онлайн-заказы", "получают свободный остаток", GREEN_LIGHT, GREEN)
        self._box(c, 114 * mm, 15 * mm, 38 * mm, 20 * mm, "Заполнитель", "когда продаж нет", AMBER_LIGHT, AMBER)
        self._arrow(c, 84 * mm, 54 * mm, 35 * mm, 35 * mm, dashed=True)
        self._arrow(c, 84 * mm, 54 * mm, 84 * mm, 35 * mm, dashed=True)
        self._arrow(c, 84 * mm, 54 * mm, 133 * mm, 35 * mm, dashed=True)

    def _draw_edge(self, c):
        self._box(c, 8 * mm, 61 * mm, 42 * mm, 22 * mm, "Player Server", "расписания, медиа, команды", PURPLE_LIGHT, PURPLE)
        self._box(c, 63 * mm, 61 * mm, 42 * mm, 22 * mm, "Go-демон", "sync, cache, PoP, watchdog", GREEN_LIGHT, GREEN)
        self._box(c, 118 * mm, 61 * mm, 40 * mm, 22 * mm, "Chromium", "только отображение", BLUE_LIGHT, BLUE)
        self._arrow(c, 50 * mm, 72 * mm, 63 * mm, 72 * mm, "HTTPS / MQTT")
        self._arrow(c, 105 * mm, 72 * mm, 118 * mm, 72 * mm, "loopback")
        self._box(c, 17 * mm, 26 * mm, 34 * mm, 19 * mm, "SQLite WAL", "очередь, manifest, state", WHITE, GREEN)
        self._box(c, 67 * mm, 26 * mm, 34 * mm, 19 * mm, "Файловый кеш", "SHA-256, .part, quota", WHITE, GREEN)
        self._box(c, 117 * mm, 26 * mm, 34 * mm, 19 * mm, "Supervisor", "restart renderer, health", WHITE, GREEN)
        self._arrow(c, 84 * mm, 61 * mm, 34 * mm, 45 * mm, dashed=True)
        self._arrow(c, 84 * mm, 61 * mm, 84 * mm, 45 * mm, dashed=True)
        self._arrow(c, 84 * mm, 61 * mm, 134 * mm, 45 * mm, dashed=True)
        self._box(c, 43 * mm, 4 * mm, 80 * mm, 14 * mm, "Offline: старый подтверждённый набор продолжает играть; события копятся до ACK", "", AMBER_LIGHT, AMBER)

    def _draw_cv(self, c):
        self._box(c, 6 * mm, 60 * mm, 42 * mm, 23 * mm, "Камера на экран", "кадр полотна", BLUE_LIGHT, BLUE)
        self._box(c, 62 * mm, 60 * mm, 42 * mm, 23 * mm, "CV качества", "геометрия, сравнение, дефекты", PURPLE_LIGHT, PURPLE)
        self._box(c, 118 * mm, 60 * mm, 42 * mm, 23 * mm, "Proof-of-display", "OK / degraded / fault / unknown", GREEN_LIGHT, GREEN)
        self._arrow(c, 48 * mm, 71 * mm, 62 * mm, 71 * mm)
        self._arrow(c, 104 * mm, 71 * mm, 118 * mm, 71 * mm)
        self._box(c, 6 * mm, 23 * mm, 42 * mm, 23 * mm, "Камера на аудиторию", "люди / транспорт", BLUE_LIGHT, BLUE)
        self._box(c, 62 * mm, 23 * mm, 42 * mm, 23 * mm, "Edge CV", "детекция, треки, зоны", PURPLE_LIGHT, PURPLE)
        self._box(c, 118 * mm, 23 * mm, 42 * mm, 23 * mm, "Агрегаты", "поток, вероятное внимание", CYAN, GREEN)
        self._arrow(c, 48 * mm, 34 * mm, 62 * mm, 34 * mm)
        self._arrow(c, 104 * mm, 34 * mm, 118 * mm, 34 * mm)
        self._box(c, 54 * mm, 3 * mm, 58 * mm, 12 * mm, "Общий ключ: screen_id + play_event_id + точное время", "", WHITE, PURPLE)

    def _draw_sequence(self, c):
        lanes = ["Server", "Go", "Renderer", "Camera", "Analytics"]
        xs = [16, 48, 80, 112, 144]
        for x, name in zip(xs, lanes):
            c.setFont("Arial-Bold", 7.5)
            c.setFillColor(INK)
            c.drawCentredString(x * mm, 84 * mm, name)
            c.setStrokeColor(LINE)
            c.setDash(2, 2)
            c.line(x * mm, 10 * mm, x * mm, 80 * mm)
        c.setDash()
        events = [
            (74, 0, 1, "manifest v42"),
            (63, 1, 2, "play(creative-18)"),
            (52, 2, 1, "started"),
            (41, 3, 4, "frame + timestamp"),
            (30, 4, 0, "display matched 0.94"),
            (19, 2, 1, "completed"),
            (10, 1, 0, "PoP batch + ACK"),
        ]
        for y, a, b, label in events:
            self._arrow(c, xs[a] * mm, y * mm, xs[b] * mm, y * mm, label)

    def _draw_data(self, c):
        self._box(c, 8 * mm, 58 * mm, 35 * mm, 23 * mm, "Screen", "город, объект, часовой пояс", BLUE_LIGHT, BLUE)
        self._box(c, 50 * mm, 58 * mm, 35 * mm, 23 * mm, "Campaign", "заказ, бюджет, SLA", PURPLE_LIGHT, PURPLE)
        self._box(c, 92 * mm, 58 * mm, 35 * mm, 23 * mm, "Creative", "файл, hash, модерация", GREEN_LIGHT, GREEN)
        self._box(c, 134 * mm, 58 * mm, 25 * mm, 23 * mm, "Schedule", "версия", AMBER_LIGHT, AMBER)
        self._box(c, 22 * mm, 22 * mm, 38 * mm, 23 * mm, "Play event", "plan + actual + result", WHITE, PURPLE)
        self._box(c, 68 * mm, 22 * mm, 38 * mm, 23 * mm, "Display observation", "match + defect + confidence", WHITE, GREEN)
        self._box(c, 114 * mm, 22 * mm, 38 * mm, 23 * mm, "Audience aggregate", "count + attention + confidence", WHITE, BLUE)
        self._arrow(c, 25 * mm, 58 * mm, 41 * mm, 45 * mm, dashed=True)
        self._arrow(c, 67 * mm, 58 * mm, 41 * mm, 45 * mm, dashed=True)
        self._arrow(c, 109 * mm, 58 * mm, 87 * mm, 45 * mm, dashed=True)
        self._arrow(c, 146 * mm, 58 * mm, 41 * mm, 45 * mm, dashed=True)
        self._arrow(c, 41 * mm, 22 * mm, 87 * mm, 22 * mm, "play_event_id")
        self._arrow(c, 87 * mm, 22 * mm, 133 * mm, 22 * mm, "time window")


def page_header_footer(canvas, doc):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(21 * mm, 282 * mm, 189 * mm, 282 * mm)
        canvas.setFont("Arial-Bold", 7)
        canvas.setFillColor(PURPLE_DARK)
        canvas.drawString(21 * mm, 286 * mm, "PLAYER SERVER / РАБОЧАЯ КНИГА")
        canvas.setFont("Arial", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(189 * mm, 286 * mm, "Подготовка к рабочему совещанию")
        canvas.line(21 * mm, 14 * mm, 189 * mm, 14 * mm)
        canvas.setFont("Arial", 7)
        canvas.drawString(21 * mm, 9 * mm, "Версия 1.0 · 1 октября 2026")
        canvas.drawRightString(189 * mm, 9 * mm, f"{page}")
    canvas.restoreState()


class HandbookDocTemplate(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, pagesize=A4, **kwargs)
        frame = Frame(21 * mm, 18 * mm, 168 * mm, 261 * mm, id="normal", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=page_header_footer))


story = []


# Cover
class Cover(Flowable):
    def __init__(self):
        super().__init__()
        self.width = 168 * mm
        self.height = 261 * mm

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(PURPLE_DARK)
        c.roundRect(0, 0, self.width, self.height, 12, fill=1, stroke=0)
        c.setFillColor(PURPLE)
        c.circle(142 * mm, 225 * mm, 38 * mm, fill=1, stroke=0)
        c.setFillColor(HexColor("#9B87ED"))
        c.circle(127 * mm, 205 * mm, 18 * mm, fill=1, stroke=0)
        c.setFillColor(HexColor("#E7A159"))
        c.circle(154 * mm, 195 * mm, 11 * mm, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.roundRect(12 * mm, 230 * mm, 31 * mm, 12 * mm, 6, fill=1, stroke=0)
        c.setFillColor(PURPLE_DARK)
        c.setFont("Arial-Bold", 8)
        c.drawCentredString(27.5 * mm, 234 * mm, "PLAYER SERVER")
        p = Paragraph("Рабочая книга по DOOH-платформе", styles["TitleBig"])
        p.wrapOn(c, 128 * mm, 70 * mm)
        p.drawOn(c, 14 * mm, 154 * mm)
        s = Paragraph(
            "Автоматизация расписаний, управление экранным парком, Go-агенты, offline-работа, proof-of-play, proof-of-display и анонимная видеоаналитика.",
            styles["TitleSub"],
        )
        s.wrapOn(c, 125 * mm, 70 * mm)
        s.drawOn(c, 14 * mm, 118 * mm)
        c.setStrokeColor(HexColor("#AFA2F3"))
        c.line(14 * mm, 104 * mm, 154 * mm, 104 * mm)
        c.setFillColor(HexColor("#E7E4FF"))
        c.setFont("Arial", 9)
        c.drawString(14 * mm, 92 * mm, "Материал для подготовки к 3-часовому совещанию")
        c.drawString(14 * mm, 84 * mm, "Архитектурные схемы · вопросы · чек-листы · словарь терминов")
        c.setFillColor(WHITE)
        c.setFont("Arial-Bold", 10)
        c.drawString(14 * mm, 24 * mm, "Казань · 1 октября 2026")
        c.setFont("Arial", 7.5)
        c.setFillColor(HexColor("#DAD4FF"))
        c.drawString(14 * mm, 15 * mm, "Статус: рабочая версия для обсуждения, не промышленная спецификация")


story.append(Cover())
story.append(PageBreak())


# Contents
story += h1("Как пользоваться документом")
story.append(P("Эта рабочая книга объединяет материалы обсуждений и уточняет архитектуру. Её задача - помочь уверенно говорить с руководством, технической командой, коммерческим отделом и специалистами по компьютерному зрению."))
story.append(callout("Главное правило", "Не выдавать демонстрацию за промышленную систему. На встрече разделять: что уже работает, что проверено только локально, что является архитектурным решением и что пока требует подтверждения заказчика.", "amber"))
story.append(h2("Навигация"))
toc_rows = [
    ("1", "Резюме и бизнес-задача"),
    ("2", "Честный статус текущего прототипа"),
    ("3", "Сквозная архитектура платформы"),
    ("4", "Автоматизация расписания и рекламного инвентаря"),
    ("5", "Player Server и архитектура плеера"),
    ("6", "Надёжность, offline и proof-of-play"),
    ("7", "Компьютерное зрение и proof-of-display"),
    ("8", "Анонимная аналитика аудитории"),
    ("9", "Пилот, KPI и критерии приёмки"),
    ("10", "План 3-часового совещания и чек-лист"),
    ("11", "Словарь терминов"),
    ("12", "Вопросы руководителя и готовые ответы"),
]
story.append(data_table(["Раздел", "Содержание"], toc_rows, [22 * mm, 144 * mm]))
story.append(Spacer(1, 5 * mm))
story.append(h2("Обозначения"))
story.append(data_table(
    ["Метка", "Смысл"],
    [
        ("Подтверждено", "Наблюдалось в текущем локальном стенде или зафиксировано тестами."),
        ("Прототип", "Рабочая демонстрационная реализация без доказанной промышленной эксплуатации."),
        ("Требование", "Функция, которую нужно согласовать с заказчиком и реализовать."),
        ("Гипотеза", "Предположение о бизнес-правиле, которое нельзя считать решением до подтверждения."),
    ],
    [35 * mm, 131 * mm],
))
story.append(PageBreak())


# Executive summary
story += h1("1. Резюме для руководства")
story.append(P("Проект нельзя сводить к проигрыванию видеороликов. Он должен управлять рекламным инвентарём: принимать заказы из нескольких каналов, резервировать доступное время, собирать расписание без конфликтов, доставлять его на устройства, подтверждать фактическое воспроизведение и обнаруживать физические неисправности экранов."))
story.append(ArchitectureDiagram("platform"))
story.append(Spacer(1, 4 * mm))
story.append(callout("Ключевой вывод", "Главная ценность - единый проверяемый путь от оплаченного заказа до подтверждённого показа на исправном физическом экране.", "green"))
story.append(h2("Какие бизнес-проблемы решаются"))
story += bullets([
    "снижение зависимости от ручной сборки расписания;",
    "предотвращение двойного бронирования и случайного вытеснения гарантированных кампаний;",
    "быстрое включение онлайн-заказов в свободный инвентарь;",
    "продолжение показа при потере связи;",
    "сверка плановых и фактических показов;",
    "обнаружение чёрного экрана, зависания, неисправных LED-модулей и других дефектов;",
    "анонимная оценка аудитории и вероятного внимания к конкретному ролику.",
])
story.append(h2("Фраза для начала встречи"))
story.append(P("«После прошлого показа стало понятно, что задача находится не только в воспроизведении контента. Необходимо связать продажи, доступный рекламный инвентарь, правила приоритетов, автоматическое расписание, состояние оборудования и фактическую отчётность. Предлагаю сегодня зафиксировать текущий процесс, исключения и критерии пилота».", "QuoteRU"))
story.append(PageBreak())


# Current status
story += h1("2. Что действительно есть сейчас")
story.append(callout("Подтверждено локально", "Демонстрационный парк запускает 100 отдельных Go-процессов с уникальными идентификаторами, портами, каталогами данных, SQLite и heartbeat. Это подтверждает механизм регистрации и наблюдения парка, но не равняется 100 физическим экранам и не является доказанным нагрузочным тестом промышленной сети.", "blue"))
status_rows = [
    ("100 Go-агентов", "Есть локальный запуск отдельных процессов и единый реестр.", "Нет 100 мини-ПК, контроллеров и физических экранов."),
    ("Player Server", "Панель управления, парк устройств, расписания, контент и журналы.", "Требуются роли, промышленная безопасность, SLA и реальная интеграция с системами заказчика."),
    ("Локальный агент", "SQLite WAL, файловый кеш, очередь PoP, SHA-256, докачивание, квота.", "Astra Linux и целевое железо ещё должны пройти отдельную приёмку."),
    ("Offline", "Агент сохраняет подтверждённый набор и очередь событий.", "Не подтверждены длительный offline, отказ накопителя и физическое отключение питания на целевой машине."),
    ("Proof-of-play", "started/completed/interrupted/failed, повторная доставка и ACK.", "Это сообщение ПО, а не независимое доказательство изображения на LED-полотне."),
    ("CMS-референс", "Отдельная CMS с нейтральным брендингом Player Server.", "Go-агенты работают с собственным manifest API; это не полная интеграция через XMDS/XMR."),
]
story.append(data_table(["Блок", "Что готово", "Чего это не доказывает"], status_rows, [31 * mm, 68 * mm, 67 * mm]))
story.append(Spacer(1, 4 * mm))
story.append(h2("Что честно говорить") )
story += bullets([
    "«Это работающий вертикальный срез архитектуры, а не готовый промышленный продукт».",
    "«100 локальных агентов показывают модель управления парком; масштаб подтверждается отдельным нагрузочным испытанием».",
    "«Proof-of-play подтверждает событие плеера, а proof-of-display потребует камеры и CV-контура».",
    "«Конкретные правила приоритетов должны утвердить коммерческий и операционный блоки».",
])
story.append(PageBreak())


# Business processes
story += h1("3. Бизнес-процесс: от продажи до отчёта")
story.append(ArchitectureDiagram("scheduler"))
story.append(h2("Основные сущности"))
story.append(data_table(
    ["Сущность", "Простое объяснение"],
    [
        ("Заказ", "Коммерческое обязательство: что куплено, где, когда, в каком объёме и по какой цене."),
        ("Кампания", "Набор правил и материалов одного размещения."),
        ("Креатив", "Конкретный видеоролик, изображение или HTML-материал."),
        ("Инвентарь", "Доступное рекламное время или количество показов на определённых экранах."),
        ("Бронь", "Временное или подтверждённое закрепление части инвентаря за заказом."),
        ("Плейлист", "Упорядоченный набор материалов."),
        ("Расписание", "Версионированное указание, что и когда должен воспроизводить экран."),
        ("Показ", "Одна попытка воспроизведения материала на конкретном устройстве."),
        ("Сверка", "Сравнение коммерческого обязательства, плана и фактических событий."),
    ],
    [38 * mm, 128 * mm],
))
story.append(h2("Какие источники могут конкурировать"))
story += bullets([
    "гарантированные договоры крупных клиентов;",
    "прямые заказы менеджеров;",
    "онлайн-заказы малого бизнеса;",
    "партнёрские или программные размещения;",
    "социальные и обязательные сообщения;",
    "собственный контент-заполнитель.",
])
story.append(callout("Не утверждать без согласования", "Приоритеты ниже приведены как модель обсуждения. Реальные правила должны быть подтверждены владельцем продукта, коммерческим директором и операционной командой.", "amber"))


# Priority and algorithm
story += h1("4. Приоритеты и алгоритм расписания")
priority_rows = [
    ("0", "Экстренное сообщение / техническая остановка", "Может остановить обычный эфир"),
    ("1", "Законодательное или обязательное размещение", "Правила задаются отдельно"),
    ("2", "Гарантированная контрактная кампания", "Нельзя вытеснять без разрешения"),
    ("3", "Прямое подтверждённое размещение", "Имеет закреплённый объём"),
    ("4", "Онлайн-заказ / программная закупка", "Использует доступный остаток"),
    ("5", "Собственный заполнитель", "Показывается при отсутствии продажи"),
]
story.append(data_table(["Уровень", "Пример", "Смысл"], priority_rows, [19 * mm, 82 * mm, 65 * mm]))
story.append(h2("Алгоритм формирования") )
story += numbered([
    "Получить кандидатов для конкретного экрана и временного окна.",
    "Отбросить неподходящие кампании: период не начался, бюджет исчерпан, креатив не прошёл модерацию, формат не поддерживается, экран не входит в таргетинг.",
    "Закрепить гарантированные обязательства.",
    "Распределить остаток между онлайн-заказами с учётом цены, pacing, частоты и равномерности.",
    "Проверить конкурентное соседство, ограничения категорий и максимальную длину цикла.",
    "Заполнить пустое место собственным материалом.",
    "Создать неизменяемую версию расписания и список обязательных файлов.",
    "Активировать новую версию только после подтверждения готовности кеша.",
    "После показа сравнить план с proof-of-play и, при наличии камеры, с proof-of-display.",
])
story.append(h2("Критические конфликтные ситуации"))
conflict_rows = [
    ("Два покупателя берут последний слот", "Транзакционная бронь, уникальный ключ, TTL и идемпотентный платёжный запрос."),
    ("Оплата есть, модерация не пройдена", "Заранее определить срок резерва, замену креатива, перенос или возврат."),
    ("Заказ отменён после доставки", "Новая версия расписания; текущий ролик не обрывается в середине."),
    ("Файл не скачан", "Не активировать manifest; продолжать старый безопасный набор или fallback."),
    ("Экран offline", "Показывать кеш, копить события; не считать неподтверждённые показы автоматически оплачиваемыми."),
    ("Сбились часы", "UTC на сервере, локальный часовой пояс, NTP/RTC и контроль drift."),
]
story.append(data_table(["Ситуация", "Необходимое правило"], conflict_rows, [63 * mm, 103 * mm]))
story.append(PageBreak())


# Edge player
story += h1("5. Архитектура Player Server и плеера")
story.append(ArchitectureDiagram("edge"))
story.append(h2("Почему Go + Chromium") )
story.append(P("Go-демон отвечает за надёжность и системные обязанности, а Chromium - только за отображение. Такое разделение позволяет перезапустить зависший рендер, не потеряв расписание, кеш и очередь событий."))
story.append(data_table(
    ["Компонент", "Ответственность"],
    [
        ("Player Server", "Устройства, контент, расписания, команды, статусы, отчёты и интеграции."),
        ("Go-агент", "Синхронизация, загрузка, проверка хэшей, локальное состояние, PoP, телеметрия, watchdog."),
        ("SQLite WAL", "Manifest, состояние команд, очередь событий, checkpoints и локальные настройки."),
        ("Файловый кеш", "Проверенные медиафайлы по SHA-256, временные .part и контроль квоты."),
        ("Локальный HTTP/WS мост", "Передача плейлиста, медиа, команд и событий между агентом и рендером."),
        ("Chromium kiosk", "Декодирование и вывод видео, изображений и web-контента."),
        ("systemd / supervisor", "Автозапуск и восстановление процесса после сбоя."),
    ],
    [42 * mm, 124 * mm],
))
story.append(h2("Состояния плеера") )
story.append(data_table(
    ["Состояние", "Что происходит", "Переход"],
    [
        ("BOOT", "Самопроверка, открытие базы и блокировка каталога.", "PROVISION или ERROR"),
        ("PROVISION", "Привязка устройства и получение credentials.", "SYNC"),
        ("SYNC", "Получение manifest и подготовка контента.", "READY"),
        ("READY", "Все обязательные файлы готовы.", "PLAY"),
        ("PLAY", "Нормальное воспроизведение и журналирование.", "OFFLINE / ERROR / SYNC"),
        ("OFFLINE PLAY", "Показ из кеша, события остаются локально.", "SYNC после возврата связи"),
        ("FALLBACK", "Безопасная заставка при невозможности показа.", "SYNC / PLAY"),
    ],
    [31 * mm, 83 * mm, 52 * mm],
))
story.append(PageBreak())


# Sequence
story += h1("6. Как проходит один подтверждённый показ")
story.append(ArchitectureDiagram("sequence"))
story.append(h2("Разница трёх уровней доказательства"))
story.append(data_table(
    ["Уровень", "Что доказывает", "Чего не доказывает"],
    [
        ("Команда", "Сервер отправил задание.", "Что агент получил его и выполнил."),
        ("Proof-of-play", "Плеер запустил и завершил интервал воспроизведения.", "Что LED-полотно физически было исправно и видно аудитории."),
        ("Proof-of-display", "Камера обнаружила ожидаемое изображение на физическом экране.", "Что человек посмотрел, понял или запомнил рекламу."),
        ("Audience analytics", "В зоне была аудитория и часть людей проявила вероятное внимание.", "Идентичность человека, понимание рекламы или покупку."),
    ],
    [36 * mm, 65 * mm, 65 * mm],
))
story.append(h2("Минимальная запись proof-of-play") )
story += bullets([
    "event_id и session_id;",
    "screen_id, device_id, campaign_id, creative_id;",
    "schedule_id и версия;",
    "плановое и фактическое время начала и окончания;",
    "played_ms, status и код ошибки;",
    "SHA-256 файла и версия агента;",
    "offline/online и время поступления на сервер;",
    "уникальное ограничение event_id, чтобы повторная отправка не создавала дубль.",
])
story.append(callout("Важное различие", "completed означает завершение запланированного интервала или окончание ролика согласно правилам плеера. Для финансовой сверки определение состоявшегося показа должно быть утверждено отдельно.", "amber"))


# Reliability/security
story += h1("7. Надёжность, безопасность и эксплуатация")
story.append(h2("Обязательные проверки") )
story += bullets([
    "обрыв сети: показ продолжается из кеша, очередь растёт и потом досылается;",
    "внезапное питание: SQLite и manifest остаются согласованными;",
    "зависание Chromium: supervisor перезапускает только рендер;",
    "обрыв скачивания: .part продолжается через Range или безопасно загружается заново;",
    "повреждённый файл: неверный SHA-256 не публикуется;",
    "нехватка диска: новая версия отклоняется, старый набор остаётся рабочим;",
    "неудачное обновление: health-check и откат;",
    "сдвиг часов: события сохраняют корректный порядок и время;",
    "длительный soak-тест: отсутствие утечек и деградации.",
], checkbox=True)
story.append(h2("Минимальная безопасность") )
security_rows = [
    ("Связь", "HTTPS/TLS, защищённый MQTT, запрет удалённого plain HTTP."),
    ("Устройство", "Уникальная идентичность, отзыв credentials, ограниченные права процесса."),
    ("Команды", "command_id, TTL, подпись/аутентификация, ACK и аудит."),
    ("Контент", "SHA-256, whitelist MIME, атомарная публикация."),
    ("Обновления", "Ed25519-подпись, anti-replay sequence, A/B или иной безопасный rollback."),
    ("Админка", "Роли, MFA по требованиям, журнал действий, принцип минимальных прав."),
]
story.append(data_table(["Контур", "Требование"], security_rows, [36 * mm, 130 * mm]))
story.append(h2("Что нужно уточнить по Astra и железу") )
story += bullets([
    "точная редакция и версия Astra Linux;",
    "x86 или ARM, модель мини-ПК и объём накопителя;",
    "Intel GPU, драйвер, VA-API и реальные кодеки H.264/H.265/WebM;",
    "разрешение и частота физического экрана;",
    "наличие RTC, аппаратного watchdog, DDC/CI или HDMI-CEC;",
    "модель LED-контроллера и доступная телеметрия.",
])
story.append(PageBreak())


# CV introduction
story += h1("8. Компьютерное зрение: два независимых контура")
story.append(ArchitectureDiagram("cv"))
story.append(callout("Не смешивать задачи", "Контроль билборда и анализ аудитории требуют разных камер, ракурсов, моделей, KPI и правил хранения данных. Их объединяет только screen_id, play_event_id и синхронизированное время.", "purple"))
story.append(h2("Контур A: технический контроль") )
story += bullets([
    "сравнивает ожидаемый креатив с реальным изображением;",
    "фиксирует чёрный экран, зависание, глитч, цветовой сдвиг и повреждение модулей;",
    "отделяет неисправность экрана от неисправности или загрязнения камеры;",
    "создаёт инцидент и связывает его с конкретным показом.",
])
story.append(h2("Контур B: анонимная аналитика аудитории") )
story += bullets([
    "детектирует людей или транспорт;",
    "создаёт краткоживущие анонимные треки внутри одного кадра/камеры;",
    "считает поток, длительность нахождения и вероятный поворот к экрану;",
    "передаёт только агрегаты, а не идентичность людей.",
])
story.append(h2("Почему кадра раз в 10 секунд может не хватить") )
story.append(P("Если ролик длится 5 секунд, периодический снимок может полностью его пропустить. Для proof-of-display лучше сочетать фоновый технический мониторинг с контрольными кадрами через 1-2 секунды после начала показа и ближе к его завершению."))
story.append(PageBreak())


# Screen QA
story += h1("9. Контроль экрана и proof-of-display")
story.append(h2("Пайплайн") )
story += numbered([
    "Откалибровать положение экрана в кадре и сохранить геометрию.",
    "Вырезать область LED-полотна и выполнить перспективное преобразование.",
    "Получить ожидаемый кадр из creative_id и точной позиции ролика.",
    "Нормализовать яркость и цвет, учесть ночь, погоду и экспозицию камеры.",
    "Сравнить структуру, perceptual hash, локальные области, движение и при необходимости OCR/логотип.",
    "Выдать статус OK / degraded / fault / unknown и confidence.",
    "Подтвердить проблему несколькими кадрами, чтобы не реагировать на машину, снег или блик.",
    "Создать единый инцидент, а не сотни одинаковых уведомлений.",
])
story.append(h2("Каталог дефектов") )
defect_rows = [
    ("black_screen", "Полотно не излучает ожидаемое изображение", "Критический"),
    ("freeze", "Кадр не меняется при смене материалов", "Высокий"),
    ("wrong_content", "Фактический креатив не совпадает с планом", "Высокий"),
    ("dead_module", "Прямоугольный участок заметно темнее", "Средний/высокий"),
    ("color_shift", "Пропал канал или нарушена цветопередача", "Средний"),
    ("glitch/flicker", "Полосы, разрывы, шум, мерцание", "Зависит от длительности"),
    ("occlusion", "Экран закрыт объектом, снегом или грязью", "Средний"),
    ("camera_fault", "Камера смещена, закрыта, загрязнена или offline", "Не считать дефектом экрана"),
]
story.append(data_table(["Код", "Описание", "Реакция"], defect_rows, [34 * mm, 88 * mm, 44 * mm]))
story.append(h2("Защита от ложных тревог") )
story += bullets([
    "несколько последовательных подтверждений;",
    "разные пороги для дня и ночи;",
    "маскирование транспорта и пешеходов перед экраном;",
    "сравнение с телеметрией агента и LED-контроллера;",
    "статус unknown при плохой видимости вместо ложного fault;",
    "ручное подтверждение оператора для накопления размеченных примеров.",
])
story.append(PageBreak())


# Audience analytics
story += h1("10. Анонимная аналитика аудитории")
story.append(h2("Что можно оценивать") )
story += bullets([
    "количество людей в зоне видимости;",
    "новые анонимные траектории;",
    "направление движения;",
    "время нахождения рядом;",
    "вероятный поворот головы или корпуса к экрану;",
    "суммарное и среднее время вероятного внимания;",
    "количество и классы транспортных средств;",
    "аудиторию во время конкретного play_event_id.",
])
story.append(h2("Что нельзя обещать") )
story += bullets([
    "что человек точно прочитал и понял рекламу;",
    "что направление головы всегда равно направлению взгляда;",
    "что система доказывает запоминание бренда или покупку;",
    "что один человек никогда не будет посчитан повторно;",
    "что пол, возраст или эмоция определяются надёжно по далёкой уличной камере.",
])
story.append(data_table(
    ["Метрика", "Корректная формулировка", "Некорректная формулировка"],
    [
        ("people_in_zone", "Людей обнаружено в зоне", "Все увидели рекламу"),
        ("probable_attention", "Вероятный поворот к экрану", "Точно посмотрел"),
        ("attention_seconds", "Оценочная длительность", "Время осознанного просмотра"),
        ("unique_tracks", "Новые треки в пределах камеры", "Уникальные граждане за день"),
    ],
    [35 * mm, 65 * mm, 66 * mm],
))
story.append(h2("Принцип privacy by design") )
story += bullets([
    "обработка видеопотока на edge-устройстве;",
    "отсутствие распознавания личности и базы лиц;",
    "никаких постоянных идентификаторов между камерами;",
    "короткоживущий track_id удаляется после выхода из кадра;",
    "на сервер передаются только агрегаты и confidence;",
    "исходные кадры хранятся только для диагностической цели и ограниченный срок;",
    "доступ, удаление и сроки хранения документируются;",
    "до пилота выполняется юридическая оценка обработки данных.",
])
story.append(callout("Юридическое предостережение", "Отсутствие распознавания лиц не означает автоматическое отсутствие требований к персональным данным. Архитектуру, цели обработки, обезличивание и сроки хранения необходимо согласовать с юридической службой. Этот документ не является юридическим заключением.", "red"))
story.append(PageBreak())


# Data model
story += h1("11. Как связать данные в одну систему")
story.append(ArchitectureDiagram("data"))
story.append(h2("Главный принцип") )
story.append(P("Любой отчёт должен восстанавливаться по цепочке: заказ - кампания - креатив - версия расписания - устройство - событие плеера - наблюдение камеры - агрегат аудитории. Без общей идентификации получится набор несвязанных таблиц и спорных цифр."))
story.append(h2("Минимальные ключи") )
story += bullets([
    "screen_id - физическая рекламная поверхность;",
    "device_id - конкретный плеер или мини-ПК;",
    "campaign_id и order_id - коммерческое обязательство;",
    "creative_id и sha256 - конкретный материал;",
    "schedule_id + version - неизменяемая версия плана;",
    "play_event_id - один фактический показ;",
    "camera_id - источник наблюдения;",
    "incident_id - одна техническая проблема;",
    "UTC timestamps + timezone - единая временная ось.",
])
story.append(h2("Пример итоговой строки отчёта") )
story.append(data_table(
    ["Показ", "Плеер", "Камера", "Аудитория"],
    [[
        "creative-184<br/>17:23:10-17:23:20<br/>completed",
        "agent online<br/>played 10.0 s<br/>event ACK",
        "match 0.94<br/>degraded<br/>dark module",
        "14 в зоне<br/>5 вероятных просмотров<br/>confidence 0.78",
    ]],
    [41.5 * mm] * 4,
))
story.append(PageBreak())


# Pilot
story += h1("12. Предлагаемый пилот")
story.append(P("Не следует начинать с полной замены инфраструктуры. Пилот должен проверить сквозной путь на ограниченном наборе реальных конструкций и дать измеримый экономический результат."))
story.append(h2("Границы") )
story += bullets([
    "3-10 физических экранов в одном городе или одной эксплуатационной группе;",
    "один действующий источник заказов;",
    "три типа кампаний: гарантированная, ручная и онлайн;",
    "одна утверждённая модель приоритетов;",
    "реальный edge-компьютер и целевая версия Astra Linux;",
    "камера на экран и, при юридическом согласовании, отдельная камера на аудиторию;",
    "proof-of-play, proof-of-display, offline и отчёт план/факт.",
])
story.append(h2("Критерии приёмки") )
accept_rows = [
    ("Расписание", "Двойное бронирование невозможно; гарантированные кампании не вытесняются."),
    ("Скорость", "Онлайн-заказ выходит в эфир в согласованный SLA после оплаты и модерации."),
    ("Контент", "Неполный или повреждённый файл не активируется."),
    ("Offline", "Показ продолжается из кеша; события не теряются после восстановления."),
    ("PoP", "Повторная доставка не создаёт дублей; план и факт сопоставимы."),
    ("CV экрана", "Измерены recall, false alarm rate и detection latency на размеченных случаях."),
    ("Аудитория", "Метрика проверена ручной выборкой и сопровождается confidence."),
    ("Эксплуатация", "Инцидент создаётся один раз, назначается и закрывается с контрольным кадром."),
]
story.append(data_table(["Область", "Критерий"], accept_rows, [36 * mm, 130 * mm]))
story.append(h2("CV-метрики") )
story += bullets([
    "Recall: какая доля реальных неисправностей обнаружена;",
    "Precision: какая доля срабатываний действительно является проблемой;",
    "False alarms per screen/day: сколько ложных тревог на один экран в сутки;",
    "Detection latency: через сколько секунд обнаружен дефект;",
    "Unknown rate: как часто система честно не может принять решение;",
    "Counting error: средняя ошибка подсчёта относительно ручной разметки.",
])
story.append(PageBreak())


# 3-hour agenda
story += h1("13. План 3-часового совещания")
agenda = [
    ("0-20 мин", "Цель и боли", "Список измеримых проблем и приоритет бизнеса"),
    ("20-50 мин", "Текущий процесс и системы", "Схема движения заказа и владельцы данных"),
    ("50-90 мин", "Инвентарь и типы продаж", "Таблица приоритетов, вытеснения и компенсаций"),
    ("90-120 мин", "Алгоритм расписания", "Конфликты, бронь, модерация, граница активации"),
    ("120-145 мин", "Плеер и оборудование", "Offline, Astra, контроллеры, SLA устройства"),
    ("145-165 мин", "CV, PoP и отчётность", "Определения доказательства и метрики"),
    ("165-175 мин", "Пилот", "Экраны, данные, сценарии, критерии приёмки"),
    ("175-180 мин", "Фиксация", "Ответственные, сроки и следующая встреча"),
]
story.append(data_table(["Время", "Тема", "Результат"], agenda, [25 * mm, 53 * mm, 88 * mm]))
story.append(h2("Что записывать по каждому решению") )
story += bullets([
    "проблема и как она решается сейчас;",
    "целевое правило и исключения;",
    "источник данных и владелец;",
    "необходимый API;",
    "критерий приёмки;",
    "ответственный и срок;",
    "открытые вопросы.",
], checkbox=True)
story.append(callout("Слова-маркеры", "Особенно фиксируйте фразы: «всегда», «иногда», «кроме случаев», «оператор вручную», «по договорённости», «система сама не умеет». Именно в них обычно скрыты реальные бизнес-правила.", "purple"))
story.append(PageBreak())


# Checklist pages
story += h1("14. Чек-лист: текущие системы и расписание")
story += bullets([
    "Назвать все системы: CRM, онлайн-платформа, CMS, медиатека, отчёты, мониторинг.",
    "Определить единый источник правды по заказам, экранам и расписанию.",
    "Узнать, кто и сколько времени собирает расписание вручную.",
    "Получить список типовых ошибок за последний период.",
    "Уточнить горизонт планирования и частоту пересборки.",
    "Определить, что именно считается свободным инвентарём.",
    "Зафиксировать типы заказов и их приоритеты.",
    "Уточнить, что можно вытеснить, перенести или компенсировать.",
    "Определить момент бронирования: выбор, оплата, модерация или подтверждение.",
    "Разобрать гонку двух покупателей за последний слот.",
    "Согласовать минимальное время выхода онлайн-заказа в эфир.",
    "Уточнить длительность цикла и допустимые длительности роликов.",
    "Уточнить правила конкурентного соседства и категорийные ограничения.",
    "Зафиксировать процедуру отмены и возврата.",
], checkbox=True)
story.append(h2("Модерация и контент") )
story += bullets([
    "Кто модерирует и сколько это занимает?",
    "Какие форматы, кодеки, разрешения и размеры разрешены?",
    "Есть ли автоматическая конвертация?",
    "Какие категории запрещены на отдельных объектах?",
    "Что происходит с бронью после отклонения креатива?",
    "Может ли клиент заменить материал без новой оплаты?",
    "Какая система хранит оригинал и производные файлы?",
], checkbox=True)
story.append(PageBreak())

story += h1("15. Чек-лист: плеер, устройства и эксплуатация")
story += bullets([
    "Точная версия Astra Linux и модель целевого мини-ПК.",
    "Архитектура CPU, GPU, накопитель и объём RAM.",
    "Модели LED-контроллеров и доступные API/протоколы.",
    "Как устройство регистрируется и получает credentials?",
    "Частота heartbeat и правило статуса online/offline.",
    "Как доставляются расписание, команды и медиа?",
    "Максимальный срок автономной работы.",
    "Политика квоты кеша и защищённые наборы.",
    "Поведение при нехватке диска и повреждении файла.",
    "NTP, RTC и допустимое отклонение времени.",
    "Watchdog, автозапуск и восстановление Chromium.",
    "OTA, подпись, health-gate и rollback.",
    "Роли пользователей, журнал действий и отзыв доступа.",
    "Канал уведомлений и SLA ремонта.",
    "Как считаются потерянные и компенсационные показы?",
], checkbox=True)
story.append(h2("Proof-of-play") )
story += bullets([
    "Что считается состоявшимся показом?",
    "Какие поля обязательны для финансовой сверки?",
    "Как исключаются дубли?",
    "Как принимаются поздние offline-события?",
    "Какой срок хранения журнала?",
    "Кому и в каком формате выдаётся отчёт?",
], checkbox=True)
story.append(PageBreak())

story += h1("16. Чек-лист: компьютерное зрение")
story.append(h2("Камера на экран") )
story += bullets([
    "Сколько камер уже установлено и на каких конструкциях?",
    "Как часто снимается кадр, есть ли видеопоток?",
    "Где выполняется inference: edge или сервер?",
    "Как камера связывается с ожидаемым creative_id?",
    "Какие дефекты уже определяются?",
    "Каковы precision, recall, false alarm rate и latency?",
    "Есть ли размеченный архив реальных неисправностей?",
    "Как учитываются ночь, снег, дождь, блики и транспорт?",
    "Как отделяется camera_fault от screen_fault?",
    "Есть ли API и автоматическое создание заявки?",
], checkbox=True)
story.append(h2("Камера на аудиторию") )
story += bullets([
    "Какую метрику хочет бизнес: поток, opportunity-to-see или вероятное внимание?",
    "Пешеходы, транспорт или оба типа?",
    "Что считается просмотром и какова минимальная длительность?",
    "Как проверяется точность подсчёта?",
    "Создаются ли лица, embeddings или постоянные идентификаторы?",
    "Можно ли выполнять весь анализ локально?",
    "Какие агрегаты уходят на сервер?",
    "Каков срок хранения исходных кадров?",
    "Есть ли юридическое заключение и ответственный за персональные данные?",
    "Какие показатели разрешено показывать рекламодателю?",
], checkbox=True)
story.append(PageBreak())


# Questions CEO
story += h1("17. Жёсткие вопросы руководителя")
qa_rows = [
    ("Зачем собственная система, если есть готовая CMS?", "CMS можно использовать как компонент. Уникальная ценность - интеграция продаж, правил инвентаря, edge-устройств, факта показа и финансовой сверки."),
    ("Что предотвращает двойную продажу?", "Единый реестр инвентаря, транзакционная бронь, TTL и идемпотентные платёжные операции."),
    ("Что будет без интернета?", "Агент продолжит подтверждённое расписание из кеша и досылает события после восстановления."),
    ("Можно запустить заказ через 10 минут?", "Технически возможно после согласования SLA модерации, загрузки, границы активации и состояния экрана."),
    ("100 агентов означают готовность к 10 000 экранов?", "Нет. Это проверка модели процесса и реестра. Нужны нагрузочные, сетевые и длительные испытания."),
    ("Камера доказывает показ?", "Она усиливает доказательство до proof-of-display, но требует калибровки, confidence и правил обработки unknown."),
    ("Мы узнаем, кто смотрел?", "Нет. Безопасный вариант даёт анонимные агрегаты и вероятное внимание без идентификации личности."),
    ("Сколько это займёт?", "Срок можно оценить после фиксации API, правил приоритетов, пилотных экранов и критериев приёмки."),
]
story.append(data_table(["Вопрос", "Сильный и честный ответ"], qa_rows, [62 * mm, 104 * mm]))
story.append(h2("Чего не обещать") )
story += bullets([
    "полную автоматизацию до описания исключений;",
    "промышленную масштабируемость по одному локальному стенду;",
    "физический показ только на основании PoP;",
    "точное определение взгляда, возраста, пола или эмоции;",
    "готовность к Astra без испытания на целевом образе;",
    "полную white-label независимость без проверки лицензий и юридических страниц стороннего ПО.",
])
story.append(PageBreak())


# Glossary 1
story += h1("18. Словарь терминов: бизнес и платформа")
gloss1 = [
    ("DOOH", "Digital Out-of-Home - цифровая наружная реклама."),
    ("CMS", "Система управления контентом, экранами, плейлистами и расписаниями."),
    ("DSP", "Платформа, через которую рекламодатель закупает размещение."),
    ("SSP", "Платформа, через которую владелец инвентаря предоставляет его для программной продажи."),
    ("Ad inventory", "Доступный объём рекламного времени или показов."),
    ("Slot", "Позиция или временной интервал внутри рекламного цикла."),
    ("Loop", "Повторяющийся цикл рекламных материалов."),
    ("Daypart", "Часть суток с отдельными правилами или ценой."),
    ("Campaign", "Кампания с периодом, бюджетом, таргетингом и креативами."),
    ("Creative", "Конкретный рекламный материал."),
    ("Pacing", "Равномерное распределение показов или бюджета во времени."),
    ("Frequency cap", "Ограничение числа показов за период."),
    ("Priority", "Порядок разрешения конфликтов между заказами."),
    ("Preemption", "Вытеснение одного размещения другим по правилам приоритета."),
    ("Makegood", "Компенсационный показ за невыполненное обязательство."),
    ("OTS", "Opportunity to See - оценка потенциальной возможности увидеть рекламу."),
    ("CPM", "Стоимость тысячи рекламных контактов или показов по принятой методике."),
    ("SLA", "Измеримое обязательство по скорости, доступности или качеству сервиса."),
    ("Single source of truth", "Система, данные которой считаются главным достоверным источником."),
    ("Reconciliation", "Сверка заказа, плана, факта и финансового результата."),
]
story.append(data_table(["Термин", "Объяснение"], gloss1, [43 * mm, 123 * mm]))
story.append(PageBreak())


# Glossary 2
story += h1("19. Словарь терминов: архитектура и надёжность")
gloss2 = [
    ("Edge", "Вычисление рядом с экраном или камерой, а не в центральном облаке."),
    ("Agent", "Программа на устройстве, которая получает задания и отправляет телеметрию."),
    ("Manifest", "Версионированный список расписания, файлов и их контрольных сумм."),
    ("Heartbeat", "Периодический сигнал, что устройство работает."),
    ("Telemetry", "Технические показатели: CPU, RAM, диск, температура, версия и ошибки."),
    ("Watchdog", "Механизм, который перезапускает зависший компонент."),
    ("Kiosk mode", "Полноэкранный режим без обычного интерфейса браузера."),
    ("Loopback", "Локальная сеть устройства, обычно 127.0.0.1, недоступная извне."),
    ("WebSocket", "Постоянное двустороннее соединение для событий и команд."),
    ("MQTT", "Лёгкий протокол сообщений для телеметрии и команд устройствам."),
    ("QoS", "Уровень гарантии доставки сообщения MQTT."),
    ("LWT", "Last Will and Testament - сообщение брокера при неожиданной потере устройства."),
    ("SQLite WAL", "Режим журнала SQLite для устойчивых конкурентных записей."),
    ("SHA-256", "Контрольная сумма для проверки целостности файла."),
    ("Idempotency", "Повтор операции не создаёт дополнительный эффект или дубль."),
    ("ACK", "Подтверждение успешного получения и обработки."),
    ("TTL", "Срок действия брони, команды или сообщения."),
    ("OTA", "Удалённое обновление программного обеспечения устройства."),
    ("Rollback", "Возврат к предыдущей рабочей версии."),
    ("mTLS", "Взаимная TLS-аутентификация сервера и устройства сертификатами."),
    ("NTP / RTC", "Сетевой протокол времени и аппаратные часы устройства."),
    ("VA-API", "Интерфейс аппаратного видеодекодирования в Linux."),
]
story.append(data_table(["Термин", "Объяснение"], gloss2, [43 * mm, 123 * mm]))
story.append(PageBreak())


# Glossary 3
story += h1("20. Словарь терминов: компьютерное зрение")
gloss3 = [
    ("Inference", "Запуск обученной модели на новом кадре или видео."),
    ("Detection", "Обнаружение объекта и прямоугольника вокруг него."),
    ("Tracking", "Связывание одного объекта между последовательными кадрами."),
    ("Track ID", "Временный идентификатор траектории, не личность человека."),
    ("ROI", "Region of Interest - область кадра, которую нужно анализировать."),
    ("Homography", "Преобразование перспективы для выравнивания экрана на снимке."),
    ("Perceptual hash", "Компактный отпечаток визуального содержания, устойчивый к небольшим изменениям."),
    ("SSIM", "Метрика структурного сходства двух изображений."),
    ("OCR", "Распознавание текста на изображении."),
    ("Confidence", "Оценка уверенности алгоритма, а не гарантия истинности."),
    ("Ground truth", "Эталонная ручная разметка для проверки алгоритма."),
    ("Precision", "Доля правильных тревог среди всех тревог системы."),
    ("Recall", "Доля найденных реальных проблем среди всех реальных проблем."),
    ("False positive", "Система сообщила о дефекте, которого нет."),
    ("False negative", "Реальный дефект был пропущен."),
    ("Proof-of-display", "Камерное подтверждение фактического изображения на экране."),
    ("Viewability", "Условия, при которых реклама могла быть видима аудитории."),
    ("Dwell time", "Оценка времени нахождения объекта в зоне."),
    ("Head pose", "Оценка направления головы; не равна точному направлению взгляда."),
    ("Anonymization", "Меры, снижающие возможность связать данные с конкретным человеком."),
]
story.append(data_table(["Термин", "Объяснение"], gloss3, [43 * mm, 123 * mm]))
story.append(PageBreak())


# Final action plan and notes
story += h1("21. Что должно быть решено на встрече")
story += bullets([
    "Одна приоритетная бизнес-проблема первого этапа.",
    "Владелец продукта и лица, утверждающие бизнес-правила.",
    "Описание текущего процесса и список интегрируемых систем.",
    "Таблица приоритетов заказов и исключений.",
    "Определение состоявшегося показа и правила компенсации.",
    "Состав существующей системы компьютерного зрения и её API.",
    "Пилотные экраны, оборудование и доступные данные.",
    "Критерии приёмки, ответственные и даты контрольных точек.",
], checkbox=True)
story.append(h2("Три обязательных вопроса") )
story += numbered([
    "Какую проблему решаем первой: расписание, подтверждение исправности экрана или аналитику аудитории?",
    "Какие существующие системы, API, данные и оборудование компания предоставляет для пилота?",
    "На каких реальных конструкциях и по каким числам руководство признает пилот успешным?",
])
story.append(h2("Финальная формулировка") )
story.append(P("«По результатам встречи я оформлю схему текущего процесса, список требований, открытые вопросы и границы пилота. После подтверждения правил можно подготовить техническую архитектуру, оценку этапов и реалистичный план разработки».", "QuoteRU"))
story.append(Spacer(1, 8 * mm))
story.append(callout("Правильная позиция", "Не пытаться показать, что уже знаешь все ответы. Сильный специалист умеет отделить факт от гипотезы, задать точные вопросы, зафиксировать решение и затем доказать его работающим пилотом.", "green"))
story.append(PageBreak())


# Sources
story += h1("22. Источники и оговорки")
story.append(h2("Материалы проекта") )
story += bullets([
    "dooh-architecture_2.html - исходная архитектура системы мониторинга и рекламных экранов;",
    "dooh-player-architecture_1.html - архитектура медиаплеера Go + Chromium;",
    "README.md и agent/README.md - текущее устройство демонстрационного стенда;",
    "DEMO-READY.md и reports/Показ-100-экранов.md - сценарии и честные границы показа.",
])
story.append(h2("Публичные справочные материалы") )
refs = [
    ("IAB Tech Lab OpenRTB", "https://iabtechlab.com/standards/openrtb/"),
    ("SQLite WAL", "https://www.sqlite.org/wal.html"),
    ("Chromium VA-API", "https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/vaapi.md"),
    ("systemd WatchdogSec", "https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html"),
    ("OpenCV background subtraction", "https://docs.opencv.org/3.0-alpha/doc/py_tutorials/py_video/py_bg_subtraction/py_bg_subtraction.html"),
    ("152-ФЗ, статья 11", "https://www.consultant.ru/document/cons_doc_LAW_61801/7336c78762a98b5f4f698b8c3800dca1111acc16/"),
    ("Требования к обезличиванию, приказ РКН №140", "https://publication.pravo.gov.ru/document/0001202508010002"),
]
story.append(data_table(["Источник", "Адрес"], refs, [62 * mm, 104 * mm]))
story.append(Spacer(1, 7 * mm))
story.append(callout("Оговорка", "Архитектурные и бизнес-правила в документе являются основой для обсуждения. Конкретные приоритеты, SLA, биллинг, обработка персональных данных, аппаратная совместимость и промышленная готовность должны быть подтверждены ответственными специалистами компании и испытаниями на целевой инфраструктуре.", "amber"))


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = HandbookDocTemplate(
        str(OUTPUT),
        title="Player Server - рабочая книга по DOOH-платформе",
        author="Рабочий материал проекта",
        subject="Архитектура, расписания, плеер, proof-of-play и компьютерное зрение",
        leftMargin=21 * mm,
        rightMargin=21 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
