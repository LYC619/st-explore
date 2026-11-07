"""Original procedural scenery for STE. No downloaded/reference-project artwork."""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import math, random, json, hashlib
root = Path(__file__).resolve().parents[1] / 'public/play/backgrounds'
root.mkdir(parents=True, exist_ok=True)
palettes = {
'mist': ('#344b51','#b2bcab','#344d45'), 'forest': ('#183e40','#b1bc92','#183b31'),
'mountain': ('#343e54','#b6bbbd','#263b45'), 'coast': ('#28586b','#b5cabd','#24505a'),
'town': ('#565368','#e1bca1','#3e4546'), 'rain': ('#263b4b','#879d9b','#203d3f'),
'dusk': ('#56516a','#e6aa81','#384754'), 'night': ('#101b32','#596c84','#172b36'),
'garden': ('#415755','#d1cfaa','#3b5843'), 'snow': ('#647d90','#dce0d7','#879993'),
'sanctuary': ('#243b4c','#c9bca2','#30494a'), 'dawn': ('#6f7786','#edcf9d','#4f6761')}
def rgb(value): return tuple(bytes.fromhex(value[1:]))
manifest=[]
for index,(name,(sky,horizon,land)) in enumerate(palettes.items()):
    rng=random.Random(7300+index); w,h=1440,900; image=Image.new('RGB',(w,h)); pix=image.load(); a,b=rgb(sky),rgb(horizon)
    for y in range(h):
        t=min(1,y/(h*.78)); c=tuple(round(a[k]*(1-t)+b[k]*t) for k in range(3))
        for x in range(w): pix[x,y]=c
    d=ImageDraw.Draw(image,'RGBA'); sx=1010; sy=230
    for r in range(150,20,-5): d.ellipse((sx-r,sy-r,sx+r,sy+r),fill=(250,222,170,2))
    d.ellipse((sx-37,sy-37,sx+37,sy+37),fill=(255,233,187,210))
    if name=='night':
        for _ in range(120):
            x,y=rng.randrange(w),rng.randrange(480);d.ellipse((x,y,x+2,y+2),fill=(240,234,200,rng.randrange(90,210)))
    base=rgb(land)
    for layer in range(5):
        y0=420+layer*64; points=[]
        for x in range(-40,w+41,25):
            y=y0+math.sin(x/(115+layer*17)+index)*45+math.sin(x/57+layer)*18+rng.randrange(-9,9); points.append((x,y))
        color=tuple(int(base[k]*(.55+.1*layer)+rgb(horizon)[k]*(.45-.1*layer)) for k in range(3))
        d.polygon([(0,h)]+points+[(w,h)],fill=color+(255,))
    d.polygon([(590,490),(800,490),(1130,900),(130,900)],fill=(*rgb(horizon),45))
    for y in range(530,900,12):
        half=int((y-490)*1.05); mid=680+int(math.sin(y/50)*15);d.line((mid-half,y,mid+half,y),fill=(219,217,181,25),width=1)
    if name in ('town','sanctuary'):
        for x,y,size in [(200,480,80),(390,510,55),(1130,490,92),(950,540,45)]:
            d.rectangle((x-size,y,x+size,y+130),fill=(30,46,49,240));d.polygon([(x-size-15,y),(x,y-58),(x+size+15,y)],fill=(42,57,60,255))
            for wx in range(x-size+18,x+size-10,32):d.rectangle((wx,y+28,wx+14,y+61),fill=(246,211,139,180))
    else:
        for x in [45,110,180,1260,1350,1410]:
            y=650+rng.randrange(-45,55);size=rng.randrange(48,105);d.line((x,y-size,x,y+160),fill=(*base,255),width=7)
            for j in range(3):d.polygon([(x-size+j*10,y+j*37),(x,y-size*1.6+j*27),(x+size-j*10,y+j*37)],fill=(*base,240))
    if name=='rain':
        for _ in range(180):
            x,y=rng.randrange(w),rng.randrange(h);d.line((x,y,x-15,y+32),fill=(200,218,222,35),width=1)
    image.save(root/f'{name}.webp','WEBP',quality=80,method=6)
    data=(root/f'{name}.webp').read_bytes();assert len(data)<=150*1024
    manifest.append({'id':name,'width':w,'height':h,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'source':'STE original procedural landscape'})
assert sum(x['bytes'] for x in manifest)<2*1024*1024
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f"{len(manifest)} backgrounds, {sum(x['bytes'] for x in manifest)} bytes")
