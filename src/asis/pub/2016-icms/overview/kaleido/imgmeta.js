
function base64Decode(str) {
    var alphabet =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    str = str.replace(new RegExp('[^' + alphabet + ']+', 'g'), '');
    var bytes = new Uint8Array(str.length * 3 >> 2);
    var i, j, a, b, c, d;
    for (i = 0, j = 0; i + 3 < str.length; i += 4) {
        a = alphabet.indexOf(str.charAt(i));
        b = alphabet.indexOf(str.charAt(i + 1));
        c = alphabet.indexOf(str.charAt(i + 2));
        d = alphabet.indexOf(str.charAt(i + 3));
        bytes[j++] = (a << 2) | (b >> 4);
        bytes[j++] = (b << 4) | (c >> 2);
        bytes[j++] = (c << 6) | d;
    }
    switch (str.length - i) {
        case 0:
            break;
        case 2:
            a = alphabet.indexOf(str.charAt(i));
            b = alphabet.indexOf(str.charAt(i + 1));
            bytes[j++] = (a << 2) | (b >> 4);
            break;
        case 3:
            a = alphabet.indexOf(str.charAt(i));
            b = alphabet.indexOf(str.charAt(i + 1));
            c = alphabet.indexOf(str.charAt(i + 2));
            bytes[j++] = (a << 2) | (b >> 4);
            bytes[j++] = (b << 4) | (c >> 2);
            break;
        default:
            throw Error('Malformed Base64 input: ' +
                (str.length - i) + ' chars left: ' + str.substr(i));
    }
    if (j !== bytes.length)
        throw Error('Failed assertion: ' + j + ' should be ' + bytes.length);
    return bytes;
}

// See PNG specification at e.g. http://www.libpng.org/pub/png/
function pngChunks(bytes) {
    function u32be(offset) {
        return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) |
            (bytes[offset + 2] << 8) | (bytes[offset + 3])) >>> 0;
    }
    if (bytes.length < 57)
        throw Error('Too short to be a PNG file');
    if (u32be(0) !== 0x89504e47 || u32be(4) !== 0x0d0a1a0a)
        throw Error('PNG signature missing');
    var chunks = [];
    var pos = 8;
    while (pos < bytes.length) {
        if (pos + 12 > bytes.length)
            throw Error('Incomplete chunk at offset 0x' + pos.toString(16));
        var len = u32be(pos);
        if (len >= 0x80000000)
            throw Error('Chunk too long');
        var end = pos + 12 + len;
        if (end > bytes.length)
            throw Error('Incomplete chunk at offset 0x' + pos.toString(16));
        var type = bytes.subarray(pos + 4, pos + 8);
        type = String.fromCharCode.apply(String, type);
        chunks.push({
            len: len,
            type: type,
            data: bytes.subarray(pos + 8, pos + 8 + len),
            crc: u32be(pos + 8 + len)
        });
        pos = end;
    }
    return chunks;
}

// End portion copied from RenderBackends.js
//////////////////////////////////////////////////////////////////////

function latin1Decode(bytes) {
    return String.fromCharCode.apply(String, bytes);
}

function utf8Decode(bytes) {
    return decodeURIComponent(Array.prototype.map.call(bytes, function(b) {
        var s = b.toString(16);
        if (s.length === 1)
            return "%0" + s;
        return "%" + s;
    }).join(""));
}

function plugin(api) {
    api.defineFunction("xmpdescription", 1, function(args, modifs) {
        var img = api.evaluate(args[0]);
        if (img.ctype === "image") { // dropped image file
            img = img.value;
        } else if (img.ctype === "string") {
            img = api.getImage(img.value);
            if (!img || !img.src) {
                console.warn(img.value + " does not name an image");
                return api.nada;
            }
        } else {
            console.warn("Argument does not name an image");
            return api.nada;
        }
        var data = img.src.replace(/^data:image\/png;base64,/, "");
        if (data === img.src) {
            console.warn("Only data:image/png;base64,… supported");
            return api.nada;
        }
        var chunks = pngChunks(base64Decode(data));
        var iTXt = chunks.filter(function(chunk) {
            return chunk.type === 'iTXt';
        });
        iTXt = iTXt.map(function(chunk) {
            var d = chunk.data;
            var indexOf = Array.prototype.indexOf.bind(d);
            var pos1 = indexOf(0);
            var pos2 = indexOf(0, pos1 + 3);
            var pos3 = indexOf(0, pos2 + 1);
            var textBytes = chunk.data.subarray(pos3 + 1);
            var compressed = !!d[pos1 + 1];
            var text = null;
            if (!compressed) text = utf8Decode(textBytes);
            return {
                chunkType: "iTXt",
                keyword: latin1Decode(chunk.data.subarray(0, pos1)),
                compressed: compressed,
                compressionMethod: d[pos1 + 2],
                language: latin1Decode(chunk.data.subarray(pos1 + 3, pos2)),
                trKeyword: utf8Decode(chunk.data.subarray(pos2 + 1, pos3)),
                textBytes: textBytes,
                text: text
            }
        });
        var texts = {};
        iTXt.forEach(function(chunk) {
            texts[chunk.keyword] = chunk;
        });
        var xmp = texts["XML:com.adobe.xmp"];
        if (!xmp) {
            console.warn("No XMP chunk found");
            return api.nada;
        }
        if (xmp.compressed) {
            console.warn("XMP compressed");
            return api.nada;
        }
        console.log(xmp.text);
        var ns = {
            x: "adobe:ns:meta/",
            dc: "http://purl.org/dc/elements/1.1/",
            rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
        };
        try {
            var parser = new DOMParser();
            xmp = parser.parseFromString(xmp.text, "application/xml");
            var node = xmp.getElementsByTagNameNS(ns.dc, "description")[0];
            node = node.getElementsByTagNameNS(ns.rdf, "li")[0];
            return {
                ctype: "string",
                value: String(node.textContent)
            };
        } catch (e) {
            console.error(e);
            return api.nada;
        }
    });
}
plugin.apiVersion = 1;