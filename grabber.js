// The "Scan my X profile" bookmarklet. app.js turns this function into a
// javascript: link. It runs on x.com in the user's own logged-in tab, scrolls
// their OWN profile (posts/replies/reposts, or their private Likes page), and
// saves what it saw as a .json file to drop on the site. It refuses to run on
// anyone else's profile.
function bygcGrabber() {
  if (window.__bygc) return;
  var panel = document.createElement("div");
  panel.style.cssText = "position:fixed;z-index:99999;right:16px;bottom:16px;width:290px;padding:14px 16px;border-radius:12px;background:#17171a;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.5)";
  document.body.appendChild(panel);
  var say = function (html) { panel.innerHTML = '<div style="font-weight:700;margin-bottom:6px">🧹 Before You Get Cancelled</div>' + html; };
  var close = function () { panel.remove(); window.__bygc = null; };

  var meLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  var me = meLink ? meLink.getAttribute("href").replace(/^\//, "").toLowerCase() : "";
  var parts = location.pathname.split("/").filter(Boolean);
  var page = (parts[0] || "").toLowerCase();
  var tab = (parts[1] || "").toLowerCase();
  if (location.hostname.replace(/^www\./, "") !== "x.com" && location.hostname.replace(/^www\./, "") !== "twitter.com") {
    say("Open <b>x.com</b>, go to your own profile, then click this bookmark again.");
    setTimeout(close, 6000);
    return;
  }
  if (!me || page !== me) {
    say("This only works on <b>your own</b> profile while you're logged in. Click your profile icon on X, then click this bookmark again.");
    setTimeout(close, 7000);
    return;
  }
  var kindDefault = tab === "likes" ? "like" : "post";
  if (tab !== "with_replies" && tab !== "likes") {
    say("Tip: open your <b>Replies</b> tab to grab posts, replies and reposts together, or your <b>Likes</b> tab for likes. Starting on this tab anyway…");
  }

  var st = (window.__bygc = { items: {}, stale: 0, stop: false });
  var grab = function () {
    var added = 0;
    document.querySelectorAll('article[data-testid="tweet"]').forEach(function (a) {
      var t = a.querySelector('a[href*="/status/"] time');
      if (!t) return;
      var m = t.closest("a").getAttribute("href").match(/^\/([^/]+)\/status\/(\d+)/);
      if (!m) return;
      var author = m[1].toLowerCase();
      var ctx = (a.querySelector('[data-testid="socialContext"]') || {}).innerText || "";
      var kind = kindDefault;
      if (kind !== "like") {
        if (/repost/i.test(ctx)) kind = "retweet";
        else if (author !== me) return; // someone else's post shown above your reply
        else kind = /Replying to/i.test(a.innerText) ? "reply" : "post";
      }
      var key = kind + ":" + m[2];
      if (st.items[key]) return;
      var txt = a.querySelector('[data-testid="tweetText"]');
      st.items[key] = { id: m[2], kind: kind, author: m[1], text: txt ? txt.innerText : "", date: t.getAttribute("datetime") };
      added++;
    });
    return added;
  };
  var save = function () {
    var items = Object.keys(st.items).map(function (k) { return st.items[k]; });
    var blob = new Blob([JSON.stringify({ source: "bygc-bookmarklet", handle: me, page: tab || "posts", savedAt: new Date().toISOString(), items: items })], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "my-x-" + (kindDefault === "like" ? "likes" : "posts") + "-" + me + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    say("Saved <b>" + items.length + "</b> items. Drop the downloaded file on <b>before-you-get-cancelled.vercel.app</b>.<br><button id='bygc-x' style='margin-top:8px;padding:5px 12px;border-radius:8px;border:0;cursor:pointer'>Close</button>");
    document.getElementById("bygc-x").onclick = close;
  };
  var render = function () {
    var n = Object.keys(st.items).length;
    say("Scrolling your " + (kindDefault === "like" ? "likes" : "profile") + "… <b>" + n + "</b> found." +
      '<div style="opacity:.7;font-size:12px;margin:4px 0 8px">Keep this tab open. X only loads about your last 3,200 posts this way.</div>' +
      "<button id='bygc-s' style='padding:5px 12px;border-radius:8px;border:0;cursor:pointer;font-weight:600'>Stop &amp; save</button>");
    document.getElementById("bygc-s").onclick = function () { st.stop = true; };
  };
  var tick = function () {
    if (st.stop) return save();
    var before = Object.keys(st.items).length;
    grab();
    var retry = Array.prototype.find.call(document.querySelectorAll("button"), function (b) { return b.innerText.trim() === "Retry"; });
    if (retry) { st.stale = 0; setTimeout(function () { retry.click(); setTimeout(tick, 2500); }, 8000); return; }
    st.stale = Object.keys(st.items).length === before ? st.stale + 1 : 0;
    render();
    if (st.stale >= 15) return save();
    window.scrollTo(0, document.documentElement.scrollHeight);
    setTimeout(tick, 2200);
  };
  render();
  tick();
}
