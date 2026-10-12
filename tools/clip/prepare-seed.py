"""Make the shipped, empty CLIP seed from a CSP-created animation document.

Usage: python tools/clip/prepare-seed.py input.clip output.clip
The input must have one paper layer, one animation folder and one raster cel.
All drawing/preview data, work information and unrelated layers are removed.
No third-party production template is distributed.
"""
import json
import sqlite3
import struct
import sys
import uuid
import zlib
from pathlib import Path


def prepare(source, output):
    raw = source.read_bytes()
    assert raw[:8] == b'CSFCHUNK'
    chunks, p = [], 24
    while p < len(raw):
        tag, length = raw[p:p+8], struct.unpack_from('>Q', raw, p+8)[0]
        payload = raw[p+16:p+16+length]
        chunks.append((tag, payload))
        p += 16 + length
    db = sqlite3.connect(':memory:')
    db.deserialize(next(payload for tag, payload in chunks if tag == b'CHNKSQLi'))
    db.row_factory = sqlite3.Row
    layers = [dict(row) for row in db.execute('SELECT * FROM Layer')]
    root = next(row for row in layers if row['LayerType'] == 256)
    paper = next(row for row in layers if row['LayerType'] == 1584)
    folder = next(row for row in layers if row['AnimationFolder'] == 1)
    raster = next(row for row in layers if row['LayerType'] == 1)
    keep = [row['MainId'] for row in (root, paper, folder, raster)]
    db.execute('DELETE FROM Layer WHERE MainId NOT IN (?,?,?,?)', keep)
    db.execute('UPDATE Layer SET LayerName=?,LayerFirstChildIndex=? WHERE MainId=?', ('', paper['MainId'], root['MainId']))
    db.execute('UPDATE Layer SET LayerName=?,LayerNextIndex=? WHERE MainId=?', ('Paper', folder['MainId'], paper['MainId']))
    db.execute('UPDATE Layer SET LayerName=?,LayerNextIndex=0,LayerFirstChildIndex=? WHERE MainId=?', ('Animation', raster['MainId'], folder['MainId']))
    db.execute('UPDATE Layer SET LayerName=?,LayerNextIndex=0 WHERE MainId=?', ('1', raster['MainId']))
    for row in db.execute('SELECT MainId FROM Offscreen').fetchall():
        db.execute('UPDATE Offscreen SET BlockData=? WHERE MainId=?', (('extrnlid'+uuid.uuid4().hex.upper()).encode(), row[0]))
    for table in ('LayerComp', 'LayerCompManager'):
        db.execute('DELETE FROM '+table)
    db.execute('UPDATE Canvas SET CanvasWorkTime=0,ComicStoryLayerCreated=0,ComicStoryStoryName=?,ComicStorySubTitle=?,ComicStoryAuthorName=?', ('','',''))
    db.execute('UPDATE TimeLine SET TimeLineName=?', ('Timeline',))
    for row in db.execute('SELECT * FROM Project').fetchall():
        for name in row.keys():
            if isinstance(row[name], str) and name not in ('ProjectInternalVersion', 'DefaultPageSettingType'):
                db.execute('UPDATE Project SET "'+name+'"=?', ('',))
    db.execute('UPDATE Project SET ProjectLayerCompManager=0')
    # A clean white preview, encoded using only the Python standard library.
    w, h = db.execute('SELECT CanvasWidth,CanvasHeight FROM Canvas').fetchone()
    w, h = int(w), int(h)
    def png_chunk(tag, payload):
        return struct.pack('>I', len(payload))+tag+payload+struct.pack('>I', zlib.crc32(tag+payload))
    png = b'\x89PNG\r\n\x1a\n'+png_chunk(b'IHDR', struct.pack('>IIBBBBB',w,h,8,6,0,0,0))+png_chunk(b'IDAT',zlib.compress((b'\0'+b'\xff'*(w*4))*h))+png_chunk(b'IEND',b'')
    db.execute('UPDATE CanvasPreview SET ImageData=?', (png,))
    ids = {bytes(row[name]).decode() for row in db.execute('SELECT * FROM Track') for name in ('TrackActionMixer','TrackActionMixer2') if row[name]}
    db.execute('DELETE FROM ExternalChunk')
    kept = []
    for tag, payload in chunks:
        if tag == b'CHNKHead': kept.append((tag,payload))
        if tag == b'CHNKExta':
            length = struct.unpack_from('>Q', payload)[0]
            ext = payload[8:8+length].decode()
            if ext in ids: kept.append((tag,payload))
    offset = 24
    for tag, payload in kept:
        if tag == b'CHNKExta':
            length = struct.unpack_from('>Q',payload)[0]
            db.execute('INSERT INTO ExternalChunk (ExternalID,Offset) VALUES (?,?)',(payload[8:8+length].decode(),offset))
        offset += 16+len(payload)
    head = bytearray(kept[0][1]); struct.pack_into('>Q',head,8,offset); kept[0]=(b'CHNKHead',bytes(head))
    db.commit(); db.execute('VACUUM')
    kept += [(b'CHNKSQLi',db.serialize()),(b'CHNKFoot',b'')]
    body=b''.join(tag+struct.pack('>Q',len(payload))+payload for tag,payload in kept)
    result=b'CSFCHUNK'+struct.pack('>QQ',len(body)+24,24)+body
    assert all(not db.execute('SELECT BlockData FROM Offscreen WHERE BlockData=?',(key.encode(),)).fetchall() for key in ids)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(result)
    print(json.dumps({'bytes':len(result),'layers':len(keep),'drawingBodies':0,'mixerBodies':len(ids)}))


if __name__ == '__main__':
    prepare(Path(sys.argv[1]),Path(sys.argv[2]))
