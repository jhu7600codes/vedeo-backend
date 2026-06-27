import { Innertube, ClientType, UniversalCache } from "npm:youtubei.js";

const kv = await Deno.openKv();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Session-Id",
  "Content-Type": "application/json",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

function err(msg: string, status = 500) {
  return json({ error: msg }, status);
}

const createTvYt = async () => {
  return await Innertube.create({
    location: "RU",
    lang: "ru",
    cache: new UniversalCache(false),
  });
};

const createYt = async (credentials?: any) => {
  const instance = await Innertube.create({
    location: "RU",
    lang: "ru",
    cache: new UniversalCache(false),
  });
  if (credentials) await instance.session.signIn(credentials);
  return instance;
};

const createYtAndroid = async (credentials?: any) => {
  const instance = await Innertube.create({
    location: "RU",
    lang: "ru",
    client_type: ClientType.ANDROID,
    retrieve_player: false,
    cache: new UniversalCache(false),
  });
  if (credentials) await instance.session.signIn(credentials);
  return instance;
};

const getSession = async (sessionId: string | null) => {
  if (!sessionId) return null;
  return (await kv.get(["session", sessionId])).value as any ?? null;
};

const requireAuth = async (sessionId: string | null) => {
  const session = await getSession(sessionId);
  if (!session?.credentials) return null;
  return session.credentials;
};

const yt = await createYt();
const ytAndroid = await createYtAndroid();

const proxyUrl = (rawUrl: string | null | undefined) =>
  rawUrl ? `/proxy?url=${encodeURIComponent(rawUrl)}` : null;

const thumbUrl = (rawUrl: string | null | undefined) =>
  rawUrl ? `/thumbnail?url=${encodeURIComponent(rawUrl)}` : null;

const mapVideo = (v: any) => ({
  id: v.id,
  title: v.title?.text,
  thumbnail: thumbUrl(v.thumbnails?.[0]?.url),
  channel: v.author?.name,
  channelId: v.author?.id,
  channelAvatar: thumbUrl(v.author?.thumbnails?.[0]?.url),
  views: v.view_count?.text,
  duration: v.duration?.text,
  publishedAt: v.published?.text,
  isLive: v.is_live,
  isShort: v.is_short,
});

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const sessionId = req.headers.get("X-Session-Id");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {

    // ─── AUTH ────────────────────────────────────────────────────────────

    if (path === "/auth/start" && req.method === "POST") {
      const id = crypto.randomUUID();
      const tvYt = await createTvYt();

      tvYt.session.on("auth-pending", async (data: any) => {
        await kv.set(["session", id], {
          status: "pending",
          verification_url: data.verification_url,
          user_code: data.user_code,
          expires_in: data.expires_in,
          credentials: null,
        });
      });

      tvYt.session.on("auth", async ({ credentials }: any) => {
        const existing = (await kv.get(["session", id])).value as any ?? {};
        await kv.set(["session", id], { ...existing, status: "authenticated", credentials });
      });

      tvYt.session.on("update-credentials", async ({ credentials }: any) => {
        const existing = (await kv.get(["session", id])).value as any ?? {};
        await kv.set(["session", id], { ...existing, credentials });
      });

      tvYt.session.signIn().catch(console.error);
      await new Promise(resolve => setTimeout(resolve, 3000));

      const session = (await kv.get(["session", id])).value as any;
      if (!session) return err("Failed to start auth flow");

      return json({
        session_id: id,
        verification_url: session.verification_url,
        user_code: session.user_code,
        expires_in: session.expires_in,
      });
    }

    if (path === "/auth/status") {
      const id = url.searchParams.get("session_id");
      if (!id) return err("missing session_id", 400);
      const session = (await kv.get(["session", id])).value as any;
      if (!session) return err("session not found", 404);
      return json({
        status: session.status,
        authenticated: session.status === "authenticated",
        credentials: session.status === "authenticated" ? session.credentials : null,
      });
    }

    if (path === "/auth/logout") {
      const id = url.searchParams.get("session_id") ?? sessionId;
      if (!id) return err("missing session_id", 400);
      await kv.delete(["session", id]);
      return json({ success: true });
    }

    // ─── FEED ────────────────────────────────────────────────────────────

    if (path === "/feed") {
      const creds = await requireAuth(sessionId);
      if (!creds) return json({ error: "feed_404" }, 401);
      const authedYt = await createYt(creds);
      const feed = await authedYt.getHomeFeed();
      const videos = feed.videos?.map(mapVideo) ?? [];
      return json({ videos });
    }

    if (path === "/trending") {
      // FEtrending is the innertube browse ID for the trending page, no auth needed
      const trending = await yt.getChannel("FEtrending");
      const videos = trending.videos?.map(mapVideo) ?? [];
      return json({ videos });
    }

    // ─── SUBSCRIPTIONS ───────────────────────────────────────────────────

    if (path === "/subscriptions") {
      const creds = await requireAuth(sessionId);
      if (!creds) return json({ error: "feed_404" }, 401);
      const authedYt = await createYt(creds);
      const feed = await authedYt.getSubscriptionsFeed();
      const videos = feed.videos?.map(mapVideo) ?? [];
      return json({ videos });
    }

    if (path === "/subscribe" && req.method === "POST") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { channelId } = await req.json();
      if (!channelId) return err("missing channelId", 400);
      const authedYt = await createYt(creds);
      await authedYt.interact.subscribe(channelId);
      return json({ success: true });
    }

    if (path === "/subscribe" && req.method === "DELETE") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { channelId } = await req.json();
      if (!channelId) return err("missing channelId", 400);
      const authedYt = await createYt(creds);
      await authedYt.interact.unsubscribe(channelId);
      return json({ success: true });
    }

    // ─── SEARCH ──────────────────────────────────────────────────────────

    if (path === "/search") {
      const q = url.searchParams.get("q");
      if (!q) return err("missing q param", 400);
      const results = await yt.search(q);
      const items = results.results?.map((r: any) => ({
        type: r.type,
        id: r.id,
        title: r.title?.text ?? r.name?.text,
        thumbnail: thumbUrl(r.thumbnails?.[0]?.url),
        channel: r.author?.name,
        channelId: r.author?.id,
        channelAvatar: thumbUrl(r.author?.thumbnails?.[0]?.url),
        subscribers: r.subscriber_count?.text,
        views: r.view_count?.text,
        duration: r.duration?.text,
        publishedAt: r.published?.text,
        isLive: r.is_live,
        isShort: r.is_short,
        verified: r.author?.is_verified,
      })) ?? [];
      return json({ items });
    }

    if (path === "/suggestions") {
      const q = url.searchParams.get("q");
      if (!q) return err("missing q param", 400);
      const suggestions = await yt.getSearchSuggestions(q);
      return json({ suggestions });
    }

    // ─── VIDEO ───────────────────────────────────────────────────────────

    if (path.startsWith("/video/")) {
      const videoId = path.split("/video/")[1];
      if (!videoId) return err("missing videoId", 400);

      const creds = await requireAuth(sessionId);
      const androidInstance = creds ? await createYtAndroid(creds) : ytAndroid;
      const androidInfo = await androidInstance.getBasicInfo(videoId);
      const streamingData = androidInfo.streaming_data;

      const formats = (streamingData?.formats ?? []).map((f: any) => ({
        url: proxyUrl(f.url),
        quality: f.quality_label ?? f.quality,
        mimeType: f.mime_type,
        bitrate: f.bitrate,
        width: f.width,
        height: f.height,
        fps: f.fps,
        audioQuality: f.audio_quality,
        hasAudio: !!f.audio_quality,
        hasVideo: !!f.width,
      }));

      const adaptiveFormats = (streamingData?.adaptive_formats ?? []).map((f: any) => ({
        url: proxyUrl(f.url),
        quality: f.quality_label ?? f.quality,
        mimeType: f.mime_type,
        bitrate: f.bitrate,
        width: f.width,
        height: f.height,
        fps: f.fps,
        audioQuality: f.audio_quality,
        isAudioOnly: f.mime_type?.startsWith("audio"),
        isVideoOnly: f.mime_type?.startsWith("video") && !f.audio_quality,
      }));

      const webInstance = creds ? await createYt(creds) : yt;
      const webInfo = await webInstance.getInfo(videoId);
      const details = webInfo.basic_info;

      const related = webInfo.watch_next_feed?.map((r: any) => ({
        id: r.id,
        title: r.title?.text,
        thumbnail: thumbUrl(r.thumbnails?.[0]?.url),
        channel: r.author?.name,
        channelId: r.author?.id,
        views: r.view_count?.text,
        duration: r.duration?.text,
        publishedAt: r.published?.text,
        isShort: r.is_short,
      })) ?? [];

      return json({
        id: details.id,
        title: details.title,
        description: details.short_description,
        thumbnail: thumbUrl(details.thumbnail?.[0]?.url),
        channel: details.author,
        channelId: details.channel_id,
        views: details.view_count,
        likes: details.like_count,
        duration: details.duration,
        isLive: details.is_live,
        isShort: details.is_short,
        publishedAt: details.publish_date,
        formats,
        adaptiveFormats,
        related,
      });
    }

    // ─── LIKES ───────────────────────────────────────────────────────────

    if (path === "/like" && req.method === "POST") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { videoId } = await req.json();
      if (!videoId) return err("missing videoId", 400);
      const authedYt = await createYt(creds);
      await authedYt.interact.like(videoId);
      return json({ success: true });
    }

    if (path === "/like" && req.method === "DELETE") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { videoId } = await req.json();
      if (!videoId) return err("missing videoId", 400);
      const authedYt = await createYt(creds);
      await authedYt.interact.removeLike(videoId);
      return json({ success: true });
    }

    if (path === "/dislike" && req.method === "POST") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { videoId } = await req.json();
      if (!videoId) return err("missing videoId", 400);
      const authedYt = await createYt(creds);
      await authedYt.interact.dislike(videoId);
      return json({ success: true });
    }

    // ─── COMMENTS ────────────────────────────────────────────────────────

    if (path.startsWith("/comments/")) {
      const videoId = path.split("/comments/")[1];
      if (!videoId) return err("missing videoId", 400);
      const comments = await yt.getComments(videoId);
      const items = comments.contents?.map((c: any) => ({
        id: c.comment?.id,
        text: c.comment?.content?.text,
        author: c.comment?.author?.name,
        authorAvatar: thumbUrl(c.comment?.author?.thumbnails?.[0]?.url),
        likes: c.comment?.vote_count?.text,
        publishedAt: c.comment?.published?.text,
        replyCount: c.comment?.reply_count,
        isLiked: c.comment?.is_liked,
        authorIsCreator: c.comment?.author_is_channel_owner,
      })) ?? [];
      return json({ items, totalCount: comments.header?.comments_count?.text });
    }

    if (path === "/comment" && req.method === "POST") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { videoId, text } = await req.json();
      if (!videoId || !text) return err("missing videoId or text", 400);
      const authedYt = await createYt(creds);
      await authedYt.interact.postComment(videoId, text);
      return json({ success: true });
    }

    if (path === "/comment/like" && req.method === "POST") {
      const creds = await requireAuth(sessionId);
      if (!creds) return err("not authenticated", 401);
      const { videoId, commentId } = await req.json();
      if (!videoId || !commentId) return err("missing videoId or commentId", 400);
      const authedYt = await createYt(creds);
      const comments = await authedYt.getComments(videoId);
      const comment = comments.contents?.find((c: any) => c.comment?.id === commentId);
      if (comment?.comment) await comment.comment.like();
      return json({ success: true });
    }

    // ─── CHANNEL ─────────────────────────────────────────────────────────

    if (path.startsWith("/channel/")) {
      const channelId = path.split("/channel/")[1];
      if (!channelId) return err("missing channelId", 400);
      const channel = await yt.getChannel(channelId);
      const videos = channel.videos?.map((v: any) => ({
        id: v.id,
        title: v.title?.text,
        thumbnail: thumbUrl(v.thumbnails?.[0]?.url),
        views: v.view_count?.text,
        duration: v.duration?.text,
        publishedAt: v.published?.text,
      })) ?? [];
      return json({
        id: channelId,
        name: channel.metadata?.title,
        description: channel.metadata?.description,
        avatar: thumbUrl(channel.metadata?.avatar?.[0]?.url),
        banner: thumbUrl(channel.header?.banner?.[0]?.url),
        subscribers: channel.header?.subscriber_count?.text,
        verified: channel.header?.is_verified,
        videos,
      });
    }

    // ─── SHORTS ──────────────────────────────────────────────────────────

    if (path === "/shorts") {
      const trending = await yt.getChannel("FEtrending");
      const shorts = (trending.videos ?? [])
        .filter((v: any) => v.is_short)
        .map((v: any) => ({
          id: v.id,
          title: v.title?.text,
          thumbnail: thumbUrl(v.thumbnails?.[0]?.url),
          channel: v.author?.name,
          channelId: v.author?.id,
          views: v.view_count?.text,
        }));
      return json({ shorts });
    }

    // ─── PROXY ───────────────────────────────────────────────────────────

    if (path === "/proxy") {
      const target = url.searchParams.get("url");
      if (!target) return err("missing url param", 400);

      const range = req.headers.get("range");
      const fetchHeaders: HeadersInit = {
        "User-Agent": "com.google.android.youtube/20.10.38 (Linux; U; Android 11)",
        "Referer": "https://www.youtube.com/",
        "Origin": "https://www.youtube.com",
      };
      if (range) fetchHeaders["Range"] = range;

      const res = await fetch(target, { headers: fetchHeaders });
      const contentType = res.headers.get("content-type") ?? "video/mp4";

      return new Response(res.body, {
        status: res.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": contentType,
          "Content-Length": res.headers.get("content-length") ?? "",
          "Content-Range": res.headers.get("content-range") ?? "",
          "Accept-Ranges": "bytes",
        },
      });
    }

    if (path === "/thumbnail") {
      const target = url.searchParams.get("url");
      if (!target) return err("missing url param", 400);
      const res = await fetch(target, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://www.youtube.com/",
        }
      });
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return err("not found", 404);

  } catch (e: any) {
    console.error(e);
    return err(e?.message ?? "internal error");
  }
});
