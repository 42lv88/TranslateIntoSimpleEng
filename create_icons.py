import os
import struct
import zlib

def make_png(width, height, color_rgb):
    # PNG signature
    png = bytearray(b'\x89PNG\r\n\x1a\n')

    # IHDR chunk
    ihdr_data = struct.pack("!IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png += chunk(b'IHDR', ihdr_data)

    # IDAT chunk
    raw_data = bytearray()
    r, g, b = color_rgb
    for y in range(height):
        raw_data.append(0) # Filter type 0
        for x in range(width):
            # Simple border effect
            if x == 0 or y == 0 or x == width-1 or y == height-1:
                raw_data.extend((30, 41, 59)) # #1e293b
            else:
                raw_data.extend((37, 99, 235)) # #2563eb
    
    compressed = zlib.compress(bytes(raw_data))
    png += chunk(b'IDAT', compressed)

    # IEND chunk
    png += chunk(b'IEND', b'')

    return bytes(png)

def chunk(chunk_type, data):
    length = len(data)
    crc = zlib.crc32(chunk_type + data) & 0xffffffff
    return struct.pack("!I", length) + chunk_type + data + struct.pack("!I", crc)

def generate_extension_icons():
    os.makedirs("icons", exist_ok=True)
    sizes = [16, 48, 128]
    for size in sizes:
        png_data = make_png(size, size, (37, 99, 235))
        filepath = os.path.join("icons", f"icon{size}.png")
        with open(filepath, "wb") as f:
            f.write(png_data)
        print(f"Generated {filepath} ({len(png_data)} bytes)")

if __name__ == "__main__":
    generate_extension_icons()
