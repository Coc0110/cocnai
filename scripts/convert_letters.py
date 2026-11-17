import os
import json
import random
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

SRC_DIR = r"c:\Users\WIN\Downloads\Tạm-20261117T122537Z-1-001\Đã xong"
OUT_DIR = r"public\letters"
os.makedirs(OUT_DIR, exist_ok=True)

# 1. Convert 1b.jpg .. 5b.jpg -> back_01.webp .. back_05.webp
back_files = {}
for i in range(1, 6):
    src_path = os.path.join(SRC_DIR, f"{i}b.jpg")
    out_filename = f"back_{i:02d}.webp"
    out_path = os.path.join(OUT_DIR, out_filename)
    
    with Image.open(src_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        # Resize to max width 1600px while maintaining aspect ratio
        if w > 1600:
            new_w = 1600
            new_h = round(h * (1600 / w))
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        img.save(out_path, "WEBP", quality=92)
        print(f"Saved {out_filename}: {img.size}")
        back_files[i] = f"/letters/{out_filename}"

# 2. Convert 1.jpg .. 31.jpg -> letter_01_front.webp .. letter_31_front.webp
# Even distribution of back designs 1..5 across 31 letters
random.seed(42)
back_assignments = []
for i in range(31):
    back_assignments.append((i % 5) + 1)
random.shuffle(back_assignments)

letters_data = []

for i in range(1, 32):
    src_path = os.path.join(SRC_DIR, f"{i}.jpg")
    out_filename = f"letter_{i:02d}_front.webp"
    out_path = os.path.join(OUT_DIR, out_filename)
    
    with Image.open(src_path) as img:
        img = img.convert("RGB")
        w, h = img.size
        img.save(out_path, "WEBP", quality=95)
        
        back_design = back_assignments[i - 1]
        back_url = back_files[back_design]
        
        letters_data.append({
            "id": i,
            "front": f"/letters/{out_filename}",
            "back": back_url,
            "backDesign": back_design,
            "width": w,
            "height": h,
            "aspectRatio": round(w / h, 4)
        })
        print(f"Saved {out_filename}: {w}x{h}, back: {back_design}")

# 3. Write letters.json to both public/letters/letters.json and src/data/letters.json
out_json_public = os.path.join(OUT_DIR, "letters.json")
with open(out_json_public, "w", encoding="utf-8") as f:
    json.dump(letters_data, f, indent=2, ensure_ascii=False)

os.makedirs("src/data", exist_ok=True)
out_json_src = os.path.join("src", "data", "letters.json")
with open(out_json_src, "w", encoding="utf-8") as f:
    json.dump(letters_data, f, indent=2, ensure_ascii=False)

print(f"Successfully generated 31 letters data to {out_json_public} and {out_json_src}")
