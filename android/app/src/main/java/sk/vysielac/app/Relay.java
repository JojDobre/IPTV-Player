package sk.vysielac.app;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * The same relay the PC build runs in Node (server/proxy.js), inside the app on 127.0.0.1.
 * The web player cannot read most IPTV servers directly (no CORS headers, odd user agents), so it asks this one:
 *   /api/ping, /api/fetch?url=, /api/stream?url= (HLS playlists rewritten), /api/img?url=, /api/probe?url=
 * Optional on every route: ua (User-Agent), ref (Referer).
 * Pairing (a phone sends the playlist, or another OnAir its channels and categories, to this TV): /api/pair-start,
 * /api/pair-poll and /pair?t=. Sending channels and categories from here: /api/share-start (POST the bundle) and
 * /share?t= (another device reads it). /pair and /share are the only things reachable from the home network;
 * everything else answers the app on this device only.
 */
public class Relay {
    static final String DEFAULT_UA = "VLC/3.0.20 LibVLC/3.0.20";
    private static final String[] PASS = { "Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag" };
    private static final Pattern URI_ATTR = Pattern.compile("URI=\"([^\"]+)\"");

    private ServerSocket server;
    /** Reads pair.html from the app's bundled web files (set by the plugin; null in plain-Java tests). */
    static java.util.function.Supplier<byte[]> pairPage = null;
    private static final Map<String, String[]> codes = new HashMap<>();   // token -> { expiry ms, data JSON or null }
    private static final Map<String, String[]> shares = new HashMap<>();  // token -> { expiry ms, bundle JSON }
    private static final long CODE_TTL = 15 * 60_000L;
    private static final int MAX_BODY = 4_000_000;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    public synchronized int start() throws IOException {
        if (server != null) return server.getLocalPort();
        // All interfaces, so a phone can open the pairing page; route() keeps the relay itself local.
        server = new ServerSocket(0, 64);
        Thread t = new Thread(() -> {
            while (!server.isClosed()) {
                try {
                    Socket s = server.accept();
                    pool.execute(() -> handle(s));
                } catch (IOException e) {
                    if (server.isClosed()) return;
                }
            }
        }, "vysielac-relay");
        t.setDaemon(true);
        t.start();
        return server.getLocalPort();
    }

    // ---- request handling ----

    private static class Req {
        String method, path, body = "";
        boolean local;
        Map<String, String> q = new HashMap<>();
        Map<String, String> headers = new HashMap<>();
    }

    private void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(30000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            Req r = readRequest(in);
            if (r == null) return;
            r.local = sock.getInetAddress().isLoopbackAddress();
            String len = r.headers.get("content-length");
            if (len != null && "POST".equals(r.method)) {
                int n = Math.min(MAX_BODY, Integer.parseInt(len.trim()));
                byte[] b = new byte[n];
                int got = 0;
                while (got < n) { int k = in.read(b, got, n - got); if (k < 0) break; got += k; }
                r.body = new String(b, 0, got, StandardCharsets.UTF_8);
            }
            sock.setSoTimeout(0);
            route(r, out);
        } catch (IOException ignored) {
            // The player went away (channel change, seek): nothing to report.
        }
    }

    private static Req readRequest(InputStream in) throws IOException {
        String line = readLine(in);
        if (line == null || line.isEmpty()) return null;
        String[] parts = line.split(" ");
        if (parts.length < 2) return null;
        Req r = new Req();
        r.method = parts[0];
        String target = parts[1];
        int qi = target.indexOf('?');
        r.path = qi < 0 ? target : target.substring(0, qi);
        if (qi >= 0) {
            for (String kv : target.substring(qi + 1).split("&")) {
                int e = kv.indexOf('=');
                if (e <= 0) continue;
                r.q.put(URLDecoder.decode(kv.substring(0, e), "UTF-8"), URLDecoder.decode(kv.substring(e + 1), "UTF-8"));
            }
        }
        for (String h; (h = readLine(in)) != null && !h.isEmpty(); ) {
            int c = h.indexOf(':');
            if (c > 0) r.headers.put(h.substring(0, c).trim().toLowerCase(Locale.ROOT), h.substring(c + 1).trim());
        }
        return r;
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (int b; (b = in.read()) != -1; ) {
            if (b == '\n') return sb.toString();
            if (b != '\r') sb.append((char) b);
            if (sb.length() > 16384) throw new IOException("header too long");
        }
        return sb.length() > 0 ? sb.toString() : null;
    }

    private void route(Req r, OutputStream out) throws IOException {
        if ("/pair".equals(r.path)) { pair(r, out); return; }
        if ("/share".equals(r.path)) { shareGet(r.q.get("t"), out); return; }
        if (!r.local) { text(out, 403, "Forbidden"); return; }
        if ("OPTIONS".equals(r.method)) { head(out, 204, "No Content", new HashMap<>()); return; }
        String route = r.path.startsWith("/api/") ? r.path.substring(5) : "";
        if ("pair-start".equals(route)) { pairStart(out); return; }
        if ("pair-poll".equals(route)) { pairPoll(r.q.get("t"), out); return; }
        if ("share-start".equals(route)) { shareStart(r.body.trim(), out); return; }
        if ("ping".equals(route)) { json(out, 200, "{\"ok\":true,\"ffmpeg\":false,\"rec\":false,\"native\":true}"); return; }
        String target = r.q.get("url");
        if (target == null || !target.matches("(?i)^https?://.*")) { text(out, 400, "Chýba alebo je neplatná adresa (url)."); return; }
        if (!route.equals("fetch") && !route.equals("stream") && !route.equals("img") && !route.equals("probe")) { text(out, 404, "Neznáma požiadavka"); return; }

        HttpURLConnection up;
        try {
            up = open(target, r.q.get("ua"), r.q.get("ref"), r.headers.get("range"));
        } catch (IOException e) {
            text(out, 502, "Server poskytovateľa neodpovedá (" + e.getClass().getSimpleName() + ").");
            return;
        }
        try {
            int code = up.getResponseCode();
            String finalUrl = up.getURL().toString();
            String ct = up.getContentType();
            InputStream body = code >= 400 ? up.getErrorStream() : up.getInputStream();
            if (body == null) body = new java.io.ByteArrayInputStream(new byte[0]);
            boolean gz = "gzip".equalsIgnoreCase(up.getContentEncoding());
            if (gz) body = new GZIPInputStream(body);
            body = new BufferedInputStream(body, 65536);
            String extra = (r.q.containsKey("ua") ? "&ua=" + enc(r.q.get("ua")) : "") + (r.q.containsKey("ref") ? "&ref=" + enc(r.q.get("ref")) : "");

            if (route.equals("probe")) {
                byte[] first = peek(body, 376);
                String type = sniff(ct, finalUrl, first);
                json(out, 200, "{\"status\":" + code + ",\"type\":\"" + type + "\",\"url\":" + quote(finalUrl) + ",\"contentType\":" + quote(ct) + "}");
                return;
            }

            Map<String, String> h = new HashMap<>();
            h.put("X-Final-Url", finalUrl);
            if (route.equals("stream") && code < 300) {
                byte[] first = peek(body, 16);
                if (isHls(ct, finalUrl, first)) {
                    String playlist = new String(readAll(body), StandardCharsets.UTF_8);
                    byte[] data = rewriteHls(playlist, finalUrl, extra).getBytes(StandardCharsets.UTF_8);
                    h.put("Content-Type", "application/vnd.apple.mpegurl");
                    h.put("Cache-Control", "no-cache");
                    h.put("Content-Length", String.valueOf(data.length));
                    head(out, 200, "OK", h);
                    out.write(data);
                    out.flush();
                    return;
                }
            }
            for (String p : PASS) { String v = up.getHeaderField(p); if (v != null) h.put(p, v); }
            if (gz) h.remove("Content-Length");
            h.put("Cache-Control", route.equals("img") ? "public, max-age=604800" : "no-cache");
            head(out, code, "OK", h);
            pipe(body, out);
        } finally {
            up.disconnect();
        }
    }

    // ---- pairing ----

    private static String newToken() {
        byte[] raw = new byte[12];
        new SecureRandom().nextBytes(raw);
        StringBuilder t = new StringBuilder();
        for (byte b : raw) t.append(String.format(Locale.ROOT, "%02x", b));
        return t.toString();
    }

    private void shareStart(String body, OutputStream out) throws IOException {
        if (!body.startsWith("{") || !body.endsWith("}")) { json(out, 400, "{\"error\":\"bad request\"}"); return; }
        String token = newToken();
        synchronized (shares) {
            shares.entrySet().removeIf(e -> Long.parseLong(e.getValue()[0]) < System.currentTimeMillis());
            shares.put(token, new String[] { String.valueOf(System.currentTimeMillis() + CODE_TTL), body });
        }
        StringBuilder urls = new StringBuilder();
        for (String ip : lanAddresses()) urls.append(urls.length() > 0 ? "," : "").append(quote("http://" + ip + ":" + server.getLocalPort() + "/share?t=" + token));
        json(out, 200, "{\"token\":" + quote(token) + ",\"urls\":[" + urls + "]}");
    }

    private void shareGet(String token, OutputStream out) throws IOException {
        String[] s;
        synchronized (shares) { s = token == null ? null : shares.get(token); }
        if (s == null || Long.parseLong(s[0]) < System.currentTimeMillis()) { json(out, 404, "{\"error\":\"expired\"}"); return; }
        json(out, 200, s[1]);
    }

    private void pairStart(OutputStream out) throws IOException {
        String token = newToken();
        synchronized (codes) {
            codes.entrySet().removeIf(e -> Long.parseLong(e.getValue()[0]) < System.currentTimeMillis());
            codes.put(token, new String[] { String.valueOf(System.currentTimeMillis() + CODE_TTL), null });
        }
        StringBuilder urls = new StringBuilder();
        for (String ip : lanAddresses()) urls.append(urls.length() > 0 ? "," : "").append(quote("http://" + ip + ":" + server.getLocalPort() + "/pair?t=" + token));
        json(out, 200, "{\"token\":" + quote(token) + ",\"urls\":[" + urls + "]}");
    }

    private void pairPoll(String token, OutputStream out) throws IOException {
        String[] c = alive(token);
        if (c == null) { json(out, 404, "{\"error\":\"expired\"}"); return; }
        if (c[1] == null) { json(out, 200, "{\"wait\":true}"); return; }
        synchronized (codes) { codes.remove(token); }
        json(out, 200, "{\"data\":" + c[1] + "}");
    }

    private void pair(Req r, OutputStream out) throws IOException {
        String[] c = alive(r.q.get("t"));
        if (c == null) { text(out, 403, "Kód neplatí. Na TV otvor QR kód znova. / This code has expired."); return; }
        if ("POST".equals(r.method)) {
            String b = r.body.trim();
            // The form, or another OnAir sending its channels and categories, posts a JSON object; the app reads only known fields.
            if (!b.startsWith("{") || !b.endsWith("}") || b.length() > MAX_BODY) { json(out, 400, "{\"error\":\"bad request\"}"); return; }
            synchronized (codes) { c[1] = b; }
            json(out, 200, "{\"ok\":true}");
            return;
        }
        byte[] page = pairPage != null ? pairPage.get() : null;
        if (page == null) { text(out, 404, "Not found"); return; }
        Map<String, String> h = new HashMap<>();
        h.put("Content-Type", "text/html; charset=utf-8");
        h.put("Cache-Control", "no-store");
        h.put("Content-Length", String.valueOf(page.length));
        head(out, 200, "OK", h);
        out.write(page);
        out.flush();
    }

    private static String[] alive(String token) {
        if (token == null) return null;
        synchronized (codes) {
            String[] c = codes.get(token);
            if (c == null) return null;
            if (Long.parseLong(c[0]) < System.currentTimeMillis()) { codes.remove(token); return null; }
            return c;
        }
    }

    static List<String> lanAddresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback() || ni.isVirtual()) continue;
                // Wi-Fi and ethernet first: mobile data and VPN interfaces cannot be reached from the home network.
                boolean home = ni.getName().startsWith("wlan") || ni.getName().startsWith("eth");
                for (InetAddress a : Collections.list(ni.getInetAddresses()))
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) { if (home) out.add(0, a.getHostAddress()); else out.add(a.getHostAddress()); }
            }
        } catch (Exception ignored) { }
        return out;
    }

    // ---- upstream ----

    static HttpURLConnection open(String url, String ua, String ref, String range) throws IOException {
        String u = url;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(12000);
            c.setReadTimeout(25000);
            c.setRequestProperty("User-Agent", ua != null && !ua.isEmpty() ? ua : DEFAULT_UA);
            c.setRequestProperty("Accept", "*/*");
            c.setRequestProperty("Accept-Encoding", "gzip");
            if (ref != null && !ref.isEmpty()) c.setRequestProperty("Referer", ref);
            if (range != null) c.setRequestProperty("Range", range);
            int code = c.getResponseCode();
            String loc = c.getHeaderField("Location");
            // HttpURLConnection does not follow http ↔ https redirects by itself; IPTV panels use them a lot.
            if (code >= 300 && code < 400 && loc != null) {
                u = new URL(new URL(u), loc).toString();
                c.disconnect();
                continue;
            }
            return c;
        }
        throw new IOException("too many redirects");
    }

    // ---- HLS ----

    static boolean isHls(String ct, String url, byte[] first) {
        if (ct != null && ct.toLowerCase(Locale.ROOT).contains("mpegurl")) return true;
        if (url.toLowerCase(Locale.ROOT).matches(".*\\.m3u8(\\?.*)?$")) return true;
        if (first != null && first.length > 0) {
            String head = new String(first, StandardCharsets.UTF_8).replace("﻿", "").trim();
            return head.startsWith("#EXTM3U");
        }
        return false;
    }

    static String sniff(String ct, String url, byte[] b) {
        if (isHls(ct, url, b)) return "hls";
        String c = ct == null ? "" : ct.toLowerCase(Locale.ROOT);
        String l = url.toLowerCase(Locale.ROOT);
        if (c.contains("mp2t") || l.matches(".*\\.ts(\\?.*)?$") || (b.length > 0 && (b[0] & 0xff) == 0x47 && (b.length < 189 || (b[188] & 0xff) == 0x47))) return "ts";
        if (c.contains("mp4") || l.matches(".*\\.(mp4|m4v|mov)(\\?.*)?$")) return "mp4";
        if (c.contains("dash") || l.matches(".*\\.mpd(\\?.*)?$")) return "dash";
        return "unknown";
    }

    /** Every URI in the playlist points back at this relay, resolved against the playlist's final URL. */
    static String rewriteHls(String text, String base, String extra) {
        StringBuilder out = new StringBuilder(text.length() + 512);
        for (String line : text.split("\r?\n", -1)) {
            String t = line.trim();
            if (t.isEmpty()) out.append(line);
            else if (t.startsWith("#")) {
                Matcher m = URI_ATTR.matcher(line);
                StringBuffer sb = new StringBuffer();
                while (m.find()) m.appendReplacement(sb, Matcher.quoteReplacement("URI=\"" + wrap(m.group(1), base, extra) + "\""));
                m.appendTail(sb);
                out.append(sb);
            } else out.append(wrap(t, base, extra));
            out.append('\n');
        }
        return out.toString();
    }

    private static String wrap(String u, String base, String extra) {
        try { return "/api/stream?url=" + enc(new URL(new URL(base), u).toString()) + extra; }
        catch (IOException e) { return u; }
    }

    // ---- helpers ----

    private static byte[] peek(InputStream in, int n) throws IOException {
        in.mark(n + 1);
        byte[] buf = new byte[n];
        int got = 0;
        while (got < n) { int k = in.read(buf, got, n - got); if (k < 0) break; got += k; }
        in.reset();
        byte[] r = new byte[got];
        System.arraycopy(buf, 0, r, 0, got);
        return r;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int k; (k = in.read(buf)) > 0; ) b.write(buf, 0, k);
        return b.toByteArray();
    }

    private static void pipe(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[65536];
        for (int k; (k = in.read(buf)) > 0; ) { out.write(buf, 0, k); if (in.available() == 0) out.flush(); }
        out.flush();
    }

    private static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8").replace("+", "%20"); } catch (IOException e) { return s; }
    }

    private static String quote(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    private static void head(OutputStream out, int code, String reason, Map<String, String> h) throws IOException {
        StringBuilder sb = new StringBuilder("HTTP/1.1 ").append(code).append(' ').append(reason).append("\r\n");
        sb.append("Access-Control-Allow-Origin: *\r\n");
        sb.append("Access-Control-Allow-Headers: Range, Content-Type\r\n");
        sb.append("Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n");
        sb.append("Access-Control-Expose-Headers: Content-Length, Content-Range, X-Final-Url\r\n");
        sb.append("Connection: close\r\n");
        for (Map.Entry<String, String> e : h.entrySet()) sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void json(OutputStream out, int code, String body) throws IOException { send(out, code, "application/json", body); }
    private static void text(OutputStream out, int code, String body) throws IOException { send(out, code, "text/plain; charset=utf-8", body); }

    private static void send(OutputStream out, int code, String type, String body) throws IOException {
        byte[] data = body.getBytes(StandardCharsets.UTF_8);
        Map<String, String> h = new HashMap<>();
        h.put("Content-Type", type);
        h.put("Content-Length", String.valueOf(data.length));
        h.put("Cache-Control", "no-cache");
        head(out, code, code < 300 ? "OK" : "Error", h);
        out.write(data);
        out.flush();
    }
}
