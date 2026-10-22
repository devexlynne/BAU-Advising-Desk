"""Put the tour together: title cards between steps, a caption bar under the
portal, and the corner code covered. The portal footage itself is not edited."""
import json, os, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont

D = os.environ.get("TOUR_DIR", os.path.join(os.path.dirname(__file__), "..", "tmp", "video"))
W, VH, BAR = 1440, 900, 170
H = VH + BAR
FPS = 25
NAVY, NAVY2, GOLD, TEAL, WHITE = (27, 54, 104), (19, 40, 80), (183, 141, 49), (15, 115, 85), (255, 255, 255)
SOFT = (201, 213, 234)

def sans(n, w=400): return ImageFont.truetype(f"/tmp/fonts/plex-{w}.ttf", n)
def serif(n):
    f = ImageFont.truetype("/tmp/fonts/serif-var.ttf", n); f.set_variation_by_axes([700]); return f

STEPS = ["Sign in", "Import", "Students", "Notices", "Progress", "This term", "Plan and\nschedule",
         "Course\nchain", "Contract\nsheet", "Transcript", "Email", "Ask Me", "Reports"]
TITLES = {1: ("Sign in", "Private account per advisor", "Each advisor has their own account and sees only their own students."),
          2: ("Import the files", "Automatic transcript parsing", "Transcripts, schedules and the course offering, exported from iConnect."),
          3: ("The student list", "Caseload overview", "All of the advisor's students, with the ones who need attention first."),
          4: ("Notices", "Early-warning notices", "What needs action across all students, why, and who it concerns."),
          5: ("Progress", "Academic analytics", "The analysis of one student's academic case: Hussein Ali Berro."),
          6: ("This term", "Rule engine", "The current registration, tested against the Faculty regulations."),
          7: ("Plan next term and the schedule planner", "Course recommender and schedule planner", "Ranked courses, real sections, and time conflicts caught before registration."),
          8: ("Course chain", "Prerequisite graph", "The required courses and the prerequisite links between them."),
          9: ("Contract sheet", "Automatic contract sheet", "Filled from the transcript. No student fills it in, so no copying mistakes."),
          10: ("Transcript", "Record history", "The official record, term by term, with this term's courses kept apart."),
          11: ("Email the student", "Record-based email", "Letters written from the record, sent from the advisor's own address."),
          12: ("Ask Me", "Rule-based assistant", "Questions in plain words, answered from the records and the rules."),
          13: ("Your account and reports", "Export", "The Excel report and the PDF summary of all students.")}

def chip(d, x, y, text, fill, f):
    tw = d.textlength(text, font=f)
    d.rounded_rectangle([x, y, x + tw + 22, y + 30], radius=6, fill=fill)
    d.text((x + 11, y + 5), text, font=f, fill=WHITE)
    return x + tw + 22

def tracker(d, cur, y, x0=120, x1=W - 120, light=True):
    n = len(STEPS); gw = (x1 - x0) / (n - 1)
    d.line([x0, y, x1, y], fill=(70, 95, 140) if light else (215, 222, 232), width=3)
    if cur > 1: d.line([x0, y, x0 + gw * (cur - 1), y], fill=GOLD if light else NAVY, width=4)
    for i, lab in enumerate(STEPS, 1):
        x = x0 + gw * (i - 1)
        if i == cur: r, fill, tc = 19, GOLD, WHITE
        elif i < cur: r, fill, tc = 13, (95, 125, 175) if light else NAVY, WHITE
        else: r, fill, tc = 13, NAVY2 if light else WHITE, (150, 165, 190)
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill, outline=(95, 125, 175) if i > cur else None, width=2)
        f = sans(17 if i == cur else 13, 700); t = str(i); tb = d.textbbox((0, 0), t, font=f)
        d.text((x - (tb[2] - tb[0]) / 2 - tb[0], y - (tb[3] - tb[1]) / 2 - tb[1]), t, font=f, fill=tc)
        for j, part in enumerate(lab.split("\n")):
            fl = sans(15, 700 if i == cur else 400)
            tw = d.textlength(part, font=fl)
            d.text((x - tw / 2, y + 30 + j * 19), part, font=fl, fill=GOLD if i == cur else SOFT)

LOGO = Image.open(os.environ.get("TOUR_LOGO", os.path.join(D, "logo_white.png"))).convert("RGBA")

def card(path, title, sub=None, feature=None, step=None, desc=None):
    im = Image.new("RGB", (W, H), NAVY); d = ImageDraw.Draw(im)
    for r in range(60, 900, 34):
        d.ellipse([W - 80 - r, -120 - r, W - 80 + r, -120 + r], outline=(43, 74, 128), width=1)
    lg = LOGO.resize((300, int(300 * LOGO.size[1] / LOGO.size[0])))
    im.paste(lg, (90, 70), lg)
    d.rectangle([0, H - 8, W, H], fill=GOLD)
    if step:
        tracker(d, step, 330)
        x = chip(d, 120, 470, f"STEP {step} OF 13", GOLD, sans(17, 700))
        chip(d, x + 10, 470, feature.upper(), TEAL, sans(17, 700))
        d.text((118, 525), title, font=serif(64), fill=WHITE)
        for k, line in enumerate(textwrap.wrap(desc, 70)):
            d.text((120, 625 + k * 40), line, font=sans(30), fill=SOFT)
    else:
        d.text((120, 420), title, font=serif(84), fill=WHITE)
        y = 540
        for line in (sub or "").split("\n"):
            d.text((122, y), line, font=sans(34), fill=(201, 176, 122) if y == 540 else SOFT); y += 50
    im.save(path)

def bar(path, step, text, where):
    im = Image.new("RGB", (W, BAR), NAVY); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 4], fill=GOLD)
    x = chip(d, 28, 22, f"STEP {step} OF 13", GOLD, sans(16, 700))
    x = chip(d, x + 8, 22, TITLES[step][1].upper(), TEAL, sans(16, 700))
    f = sans(17, 700); d.text((x + 26, 27), "YOU ARE HERE", font=f, fill=(125, 205, 170))
    xx = x + 26 + d.textlength("YOU ARE HERE", font=f) + 14
    for i, p in enumerate(where):
        last = i == len(where) - 1
        fp = sans(17, 700 if last else 400)
        d.text((xx, 27), p, font=fp, fill=WHITE if last else SOFT); xx += d.textlength(p, font=fp)
        if not last:
            d.text((xx + 8, 25), "›", font=sans(20, 700), fill=GOLD); xx += 30
    fc = sans(28, 400)
    lines = textwrap.wrap(text, 92)[:2]
    for k, line in enumerate(lines):
        d.text((28, 72 + k * 40), line, font=fc, fill=WHITE)
    im.save(path)

def corner_color(frame):
    """Colour just right of the code square, used to cover it."""
    out = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{frame / FPS:.3f}", "-i", f"{D}/cfr.mp4", "-vf", f"crop=4:4:30:{VH-14},scale=1:1",
                          "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    r, g, b = out[:3] if len(out) >= 3 else (255, 255, 255)
    return f"0x{r:02x}{g:02x}{b:02x}"

def run(*a): subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def still(img, out, secs):
    run("ffmpeg", "-y", "-loop", "1", "-i", img, "-t", str(secs), "-r", str(FPS), "-vf", "format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", out)

log = json.load(open(f"{D}/log.json"))
caps = [x for x in log if "n" in x]
clean = json.load(open(f"{D}/clean.json"))
start = {}
for i, c in enumerate(clean):
    if c and c not in start: start[c] = i
total = len(clean)
os.makedirs(f"{D}/parts", exist_ok=True)
parts = []

card(f"{D}/parts/intro.png", "BAU e-Advising System",
     "A guided tour of the portal\nPlanned and implemented by Dr. Julie Bu Daher, Lynn El Arwadi and Yosr Najjar\nDepartment of Mathematics and Computer Science, Faculty of Science")
still(f"{D}/parts/intro.png", f"{D}/parts/p000.mp4", 5); parts.append("p000.mp4")

prev_step = None
for k, cp in enumerate(caps):
    n = cp["n"]; s = cp["step"]
    if s != prev_step:
        t = TITLES[s]
        card(f"{D}/parts/card{s}.png", t[0], feature=t[1], step=s, desc=t[2])
        name = f"p{n:03d}a.mp4"; still(f"{D}/parts/card{s}.png", f"{D}/parts/{name}", 3); parts.append(name)
        prev_step = s
    a = start[n]; b = start.get(n + 1, total)
    bar(f"{D}/parts/bar{n}.png", s, cp["text"], cp["where"])
    name = f"p{n:03d}b.mp4"
    col = corner_color(min(a + 12, b - 1))
    vf = (f"[0:v]setpts=PTS-STARTPTS,"
          f"drawbox=x=0:y={VH-24}:w=24:h=24:color={col}:t=fill,pad={W}:{H}:0:0:color=white[v];"
          f"[v][1:v]overlay=0:{VH}:format=auto,format=yuv420p[o]")
    run("ffmpeg", "-y", "-ss", f"{a / FPS:.3f}", "-t", f"{(b - a) / FPS:.3f}", "-i", f"{D}/cfr.mp4", "-i", f"{D}/parts/bar{n}.png", "-filter_complex", vf, "-map", "[o]",
        "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", f"{D}/parts/{name}")
    parts.append(name)

card(f"{D}/parts/end.png", "BAU e-Advising System",
     "Built and running on the real records of the department's students\nDepartment of Mathematics and Computer Science, Faculty of Science")
still(f"{D}/parts/end.png", f"{D}/parts/p999.mp4", 5); parts.append("p999.mp4")

with open(f"{D}/parts/list.txt", "w") as f:
    for p in parts: f.write(f"file '{p}'\n")
run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", f"{D}/parts/list.txt", "-c", "copy", "-movflags", "+faststart",
    f"{D}/BAU-e-Advising-System-tour.mp4")
print("done", len(parts))
