"""Draws Dua's launcher icons and splash screens from the web app's icon (assets/icon-512.png).
Run by setup.sh after Capacitor has generated the project. Needs Pillow (pip install pillow)."""
import glob
import os
import sys
from PIL import Image

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
res = os.path.join(root, 'android-app', 'android', 'app', 'src', 'main', 'res')
src = Image.open(os.path.join(root, 'assets', 'icon-512.png')).convert('RGBA')

# Launcher icons: plain PNGs at every density. The stock adaptive-icon files are removed so these are used on every Android version.
for density, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    icon = src.resize((px, px), Image.LANCZOS)
    for name in ('ic_launcher.png', 'ic_launcher_round.png'):
        icon.save(os.path.join(res, f'mipmap-{density}', name))
    stale = os.path.join(res, f'mipmap-{density}', 'ic_launcher_foreground.png')
    if os.path.exists(stale):
        os.remove(stale)
for stale in ('mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml', 'drawable-v24/ic_launcher_foreground.xml',
              'values/ic_launcher_background.xml', 'drawable/ic_launcher_background.xml'):
    path = os.path.join(res, stale)
    if os.path.exists(path):
        os.remove(path)
for folder in ('mipmap-anydpi-v26', 'drawable-v24'):
    path = os.path.join(res, folder)
    if os.path.isdir(path) and not os.listdir(path):
        os.rmdir(path)

# Splash: navy background with the icon in the middle, at the same pixel sizes as the stock files.
count = 0
for path in glob.glob(os.path.join(res, 'drawable*', 'splash.png')):
    w, h = Image.open(path).size
    canvas = Image.new('RGBA', (w, h), (16, 27, 45, 255))
    side = int(min(w, h) * 0.28)
    icon = src.resize((side, side), Image.LANCZOS)
    canvas.paste(icon, ((w - side) // 2, (h - side) // 2), icon)
    canvas.convert('RGB').save(path)
    count += 1
if count == 0:
    sys.exit('no splash files found: has Capacitor generated the project?')
print(f'icons and {count} splash images written')
