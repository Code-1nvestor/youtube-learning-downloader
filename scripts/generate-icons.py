from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
DESKTOP_ICON = ROOT / "desktop" / "icon.ico"
PUBLIC_DIR = ROOT / "client" / "public"


def create_icon(size: int) -> Image.Image:
    scale = 4
    canvas_size = size * scale
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (0, 0, canvas_size - 1, canvas_size - 1),
        radius=round(canvas_size * 96 / 512),
        fill="#2563eb",
    )
    draw.polygon(
        [
            (round(canvas_size * 200 / 512), round(canvas_size * 160 / 512)),
            (round(canvas_size * 344 / 512), round(canvas_size * 256 / 512)),
            (round(canvas_size * 200 / 512), round(canvas_size * 352 / 512)),
        ],
        fill="white",
    )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    icon_192 = create_icon(192)
    icon_512 = create_icon(512)
    icon_192.save(PUBLIC_DIR / "icon-192.png", optimize=True)
    icon_512.save(PUBLIC_DIR / "icon-512.png", optimize=True)

    icon_256 = create_icon(256)
    icon_256.save(
        DESKTOP_ICON,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"Generated {DESKTOP_ICON}")
    print(f"Generated {PUBLIC_DIR / 'icon-192.png'}")
    print(f"Generated {PUBLIC_DIR / 'icon-512.png'}")


if __name__ == "__main__":
    main()
