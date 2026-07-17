from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
BUILD_DIR.mkdir(exist_ok=True)
PUBLIC_DIR = ROOT / "public"
PUBLIC_DIR.mkdir(exist_ok=True)

size = 1024
image = Image.new("RGBA", (size, size), "#182320")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((112, 112, 912, 912), radius=180, fill="#2dd4bf")
draw.rounded_rectangle((184, 184, 840, 840), radius=132, fill="#102b26")

font_paths = [Path("C:/Windows/Fonts/segoeuib.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")]
font_path = next(path for path in font_paths if path.exists())
font = ImageFont.truetype(str(font_path), 330)
text = "AI"
box = draw.textbbox((0, 0), text, font=font)
text_width = box[2] - box[0]
text_height = box[3] - box[1]
draw.text(
    ((size - text_width) / 2, (size - text_height) / 2 - box[1] - 12),
    text,
    font=font,
    fill="#f4fffc",
)

image.save(BUILD_DIR / "icon.png")
image.save(PUBLIC_DIR / "favicon.png")
image.save(
    BUILD_DIR / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
