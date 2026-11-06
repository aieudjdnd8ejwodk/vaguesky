/* トーナメント表: tournament.json（結果データ仕様 v1）を読んで #results に描く。
   データの入り口は 2 つ。
   1) DATA_URL … Bot が公開する JSON の URL。サイトを GitHub Pages などに移したらここに入れる。
      claude.ai の Artifact からは外部 URL を読めないので、それまでは null のまま。
   2) <script type="application/json" id="tournament-data"> … ページ内に貼った JSON（手動反映用）。
   データが無い・空のあいだは「開催後に公開」の表示のまま何もしない。 */
(function () {
  "use strict";

  var DATA_URL = "tournament.json"; // GitHub Pages 版：同じ場所の JSON を読む
  // 速い入り口：GitHub に置かれた最新のファイルを直接読む（Pages の公開作業を待たない）。
  // 読めないとき（回数制限など）は 10 分だけ DATA_URL に切り替える。
  var LIVE_URL = "https://api.github.com/repos/aieudjdnd8ejwodk/vaguesky/contents/tournament.json?ref=main";
  var POLL_MS = 20000;
  var liveOffUntil = 0;

  var root = document.getElementById("bracket-root");
  var empty = document.getElementById("results-empty");
  if (!root) return;

  var MATCH_STATUS = { scheduled: "予定", live: "LIVE", finished: "確定", walkover: "不戦勝" };
  var TEAM_STATUS = { disqualified: "失格", withdrawn: "辞退" };
  var CLIP_LABEL = { contra: "コントラ部門", keymouse: "キーマウ部門", tap: "タップ部門" };
  var T_STATUS = { entry: "エントリー受付中", upcoming: "組み合わせ発表", live: "大会進行中", finished: "大会終了" };

  var lastText = null;
  var data = null;
  var openMatchId = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fromPages() {
    return fetch(DATA_URL, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  function load() {
    if (DATA_URL) {
      if (LIVE_URL && Date.now() >= liveOffUntil) {
        // no-cache: 毎回「変わった？」と確認する。変わっていなければ 304 で、回数にも数えられない
        return fetch(LIVE_URL, { cache: "no-cache", headers: { Accept: "application/vnd.github.raw+json" } }).then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        }).catch(function (err) {
          console.warn("GitHub から直接読めませんでした。10分間は公開サイトの JSON を使います", err);
          liveOffUntil = Date.now() + 10 * 60 * 1000;
          return fromPages();
        });
      }
      return fromPages();
    }
    var inline = document.getElementById("tournament-data");
    return Promise.resolve(inline ? inline.textContent : "");
  }

  function refresh() {
    load().then(function (text) {
      text = (text || "").trim();
      if (!text) return;
      setNet(true);
      if (text === lastText) return;
      var d = JSON.parse(text);
      if (!d || !Array.isArray(d.matches) || !d.matches.length) {
        // 表が消された（/bracket_clear）ときは「開催後に公開」に戻す
        if (lastText !== null) { lastText = text; data = null; root.hidden = true; root.innerHTML = ""; if (empty) empty.hidden = false; }
        return;
      }
      if (d.schemaVersion !== 1) console.warn("tournament.json: schemaVersion " + d.schemaVersion + "（このページは 1 向け）");
      lastText = text;
      data = d;
      render(d);
    }).catch(function (err) {
      console.warn("tournament.json を読めませんでした", err);
      setNet(false);
    });
  }

  function setNet(ok) {
    var n = document.getElementById("bk-net");
    if (!n || !DATA_URL) return;
    n.textContent = ok ? "自動更新中" : "更新に失敗。前回のデータを表示中";
    n.className = "bk-net " + (ok ? "ok" : "ng");
  }

  function fmtTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    var d = new Date(t + 9 * 3600 * 1000); // 日本時間で表示
    return (d.getUTCMonth() + 1) + "/" + d.getUTCDate() + " " + d.getUTCHours() + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  }

  function isThird(round) {
    return !!round && (round.id === "third" || /3位/.test(round.name || ""));
  }

  // ---------- 全体 ----------
  function render(d) {
    var teams = {};
    (d.teams || []).forEach(function (t) { teams[t.id] = t; });
    var rounds = {};
    (d.rounds || []).forEach(function (r) { rounds[r.id] = r; });
    var byId = {};
    d.matches.forEach(function (m) { byId[m.id] = m; });

    var ctx = { d: d, teams: teams, rounds: rounds, byId: byId };

    root.textContent = "";
    root.appendChild(renderHead(d));
    var podium = renderPodium(ctx);
    if (podium) root.appendChild(podium);
    root.appendChild(renderBracket(ctx));
    var third = d.matches.filter(function (m) { return isThird(rounds[m.roundId]); });
    if (third.length) {
      var tw = el("div", "bk-third");
      tw.appendChild(el("h3", "bk-sub", (rounds[third[0].roundId] || {}).name || "3位決定戦"));
      third.forEach(function (m) { tw.appendChild(matchCard(ctx, m)); });
      root.appendChild(tw);
    }
    var awards = renderAwards(ctx);
    if (awards) root.appendChild(awards);

    root.hidden = false;
    if (empty) empty.hidden = true;
    if (openMatchId && byId[openMatchId]) showDetail(ctx, byId[openMatchId], true);
    window.__bk = ctx;
  }

  function renderHead(d) {
    var head = el("div", "bk-head");
    var st = (d.tournament && d.tournament.status) || "";
    var pill = el("span", "pill " + (st === "live" ? "open" : "closed"));
    pill.appendChild(el("i"));
    pill.appendChild(el("span", null, T_STATUS[st] || "トーナメント表"));
    head.appendChild(pill);
    var meta = el("span", "bk-updated");
    if (d.updatedAt) meta.textContent = "最終更新 " + fmtTime(d.updatedAt);
    head.appendChild(meta);
    if (DATA_URL) {
      var net = el("span", "bk-net ok", "自動更新中");
      net.id = "bk-net";
      head.appendChild(net);
    }
    return head;
  }

  // ---------- 表彰（決勝が確定したら） ----------
  function renderPodium(ctx) {
    var fin = findFinal(ctx);
    if (!fin || !fin.winner || (fin.status !== "finished" && fin.status !== "walkover")) return null;
    var runner = fin.winner === fin.teamA ? fin.teamB : fin.teamA;
    var wrap = el("div", "podium");
    wrap.appendChild(podiumCard(ctx, "1位", "優勝", fin.winner, "gold"));
    if (runner) wrap.appendChild(podiumCard(ctx, "2位", "準優勝", runner, "silver"));
    ctx.d.matches.forEach(function (m) {
      if (isThird(ctx.rounds[m.roundId]) && m.winner && (m.status === "finished" || m.status === "walkover")) {
        wrap.appendChild(podiumCard(ctx, "3位", "3位", m.winner, "bronze"));
      }
    });
    return wrap;
  }

  function podiumCard(ctx, rank, label, teamId, tone) {
    var t = ctx.teams[teamId] || { name: "未定" };
    var c = el("div", "podium-card " + tone);
    c.appendChild(el("span", "podium-rank", label));
    c.appendChild(el("b", "podium-team", t.name));
    var names = (t.members || []).map(function (m) { return m.displayName; }).filter(Boolean);
    if (names.length) c.appendChild(el("span", "podium-members", names.join(" ／ ")));
    return c;
  }

  // ---------- トーナメント表 ----------
  function findFinal(ctx) {
    var cands = ctx.d.matches.filter(function (m) { return !m.next && !isThird(ctx.rounds[m.roundId]); });
    cands.sort(function (a, b) { return ((ctx.rounds[b.roundId] || {}).order || 0) - ((ctx.rounds[a.roundId] || {}).order || 0); });
    return cands[0] || null;
  }

  function renderBracket(ctx) {
    var feeders = {};
    ctx.d.matches.forEach(function (m) {
      if (m.next && m.next.matchId) {
        var f = feeders[m.next.matchId] || (feeders[m.next.matchId] = {});
        f[m.next.slot === "B" ? "B" : "A"] = m;
      }
    });
    ctx.feeders = feeders;

    var order = (ctx.d.rounds || []).filter(function (r) { return !isThird(r); })
      .sort(function (a, b) { return a.order - b.order; });
    var fin = findFinal(ctx);

    // 決勝から逆にたどって、各列の枠（試合 or 空き）を上から並べる
    var cols = [[fin]];
    for (var k = 1; k < order.length; k++) {
      var prev = [];
      cols[0].forEach(function (m) {
        var f = m ? feeders[m.id] || {} : {};
        prev.push(f.A || null, f.B || null);
      });
      if (!prev.some(Boolean)) break;
      cols.unshift(prev);
    }
    var names = order.slice(order.length - cols.length);

    var scroll = el("div", "bk-scroll");
    scroll.setAttribute("tabindex", "0");
    scroll.setAttribute("aria-label", "トーナメント表（横にスクロールできます）");
    var grid = el("div", "bk");
    cols.forEach(function (col, ci) {
      var last = ci === cols.length - 1;
      var c = el("div", "bk-col" + (last ? " is-final" : ""));
      var r = names[ci] || {};
      var h = el("div", "bk-round");
      h.appendChild(el("b", null, r.name || ""));
      if (r.firstTo > 1) h.appendChild(el("small", null, "FT" + r.firstTo));
      c.appendChild(h);
      var slots = el("div", "bk-slots");
      col.forEach(function (m, i) {
        var s = el("div", "bk-slot " + (i % 2 ? "bk-lo" : "bk-hi"));
        if (m) {
          if (!last) {
            s.classList.add("has-next");
            if (m.status === "finished" || m.status === "walkover") s.classList.add("done");
          }
          var f = feeders[m.id];
          if (ci > 0 && f && (f.A || f.B)) s.classList.add("has-prev");
          s.appendChild(matchCard(ctx, m));
        }
        slots.appendChild(s);
      });
      c.appendChild(slots);
      grid.appendChild(c);
    });
    scroll.appendChild(grid);

    var box = el("div", "bk-box");
    box.appendChild(scroll);
    box.appendChild(el("p", "bk-hint", "試合をタップすると、1本ごとの結果が見られます。表は横にスクロールできます。"));
    return box;
  }

  function matchCard(ctx, m) {
    var round = ctx.rounds[m.roundId] || {};
    var b = el("button", "bk-match is-" + (m.status || "scheduled"));
    b.type = "button";
    b.setAttribute("data-id", m.id);

    var meta = el("span", "bk-meta");
    meta.appendChild(el("span", "bk-id", m.id));
    var st = el("span", "bk-st", MATCH_STATUS[m.status] || "予定");
    meta.appendChild(st);
    b.appendChild(meta);

    var showScore = m.status && m.status !== "scheduled";
    ["a", "b"].forEach(function (side) {
      var tid = side === "a" ? m.teamA : m.teamB;
      var t = tid ? ctx.teams[tid] : null;
      var row = el("span", "bk-team");
      if (!t) row.classList.add("tbd");
      else if (m.winner) row.classList.add(m.winner === tid ? "win" : "lose");
      var seed = el("span", "bk-seed", t && t.seed != null ? String(t.seed) : "");
      row.appendChild(seed);
      var nm = el("span", "bk-name", t ? t.name : (m.status === "walkover" ? "─" : "未定"));
      row.appendChild(nm);
      if (t && TEAM_STATUS[t.status]) row.appendChild(el("span", "bk-flag", TEAM_STATUS[t.status]));
      var sc = m.score ? m.score[side] : null;
      row.appendChild(el("b", "bk-score", showScore && sc != null && m.status !== "walkover" ? String(sc) : ""));
      b.appendChild(row);
    });

    var label = (round.name || "") + " " + m.id + "：" +
      teamName(ctx, m.teamA) + " 対 " + teamName(ctx, m.teamB) + "、" + (MATCH_STATUS[m.status] || "予定");
    b.setAttribute("aria-label", label);
    b.addEventListener("click", function () { showDetail(ctx, m); });
    return b;
  }

  function teamName(ctx, id) {
    return id && ctx.teams[id] ? ctx.teams[id].name : "未定";
  }

  // ---------- 試合の詳細 ----------
  var dlg = null;
  function showDetail(ctx, m, keep) {
    if (!dlg) {
      dlg = el("dialog", "bk-dialog");
      dlg.addEventListener("close", function () { openMatchId = null; });
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
      document.body.appendChild(dlg);
    }
    openMatchId = m.id;
    var round = ctx.rounds[m.roundId] || {};
    dlg.textContent = "";

    var top = el("div", "bk-dlg-top");
    var ttl = el("div");
    ttl.appendChild(el("p", "label", (round.name || "") + "　" + m.id + (round.firstTo > 1 ? "　FT" + round.firstTo : "")));
    var st = el("span", "bk-dlg-st is-" + (m.status || "scheduled"), MATCH_STATUS[m.status] || "予定");
    ttl.appendChild(st);
    top.appendChild(ttl);
    var close = el("button", "bk-close", "閉じる");
    close.type = "button";
    close.addEventListener("click", function () { dlg.close(); });
    top.appendChild(close);
    dlg.appendChild(top);

    var vs = el("div", "bk-vs");
    [["a", m.teamA], ["b", m.teamB]].forEach(function (p, i) {
      var t = p[1] ? ctx.teams[p[1]] : null;
      var side = el("div", "bk-side" + (m.winner && m.winner === p[1] ? " win" : ""));
      side.appendChild(el("b", "bk-side-name", t ? t.name : "未定"));
      if (t && TEAM_STATUS[t.status]) side.appendChild(el("span", "bk-flag", TEAM_STATUS[t.status]));
      (t && t.members || []).forEach(function (mb) {
        var line = el("span", "bk-member", mb.displayName || "");
        if (mb.mcIds && mb.mcIds.length) line.appendChild(el("small", null, mb.mcIds.join(", ")));
        side.appendChild(line);
      });
      vs.appendChild(side);
      if (i === 0) {
        var mid = el("div", "bk-vs-score num");
        if (m.status && m.status !== "scheduled" && m.status !== "walkover" && m.score) {
          mid.textContent = m.score.a + " - " + m.score.b;
        } else {
          mid.textContent = "VS";
        }
        vs.appendChild(mid);
      }
    });
    dlg.appendChild(vs);

    var games = m.games || [];
    if (m.status === "walkover") {
      dlg.appendChild(el("p", "bk-note", "不戦勝です。"));
    } else if (games.length) {
      var tbl = el("table", "bk-games");
      var thead = el("thead");
      var hr = el("tr");
      ["", "勝ち", "Kill", "point", ""].forEach(function (h) { hr.appendChild(el("th", null, h)); });
      thead.appendChild(hr);
      tbl.appendChild(thead);
      var tb = el("tbody");
      games.forEach(function (g) {
        var tr = el("tr");
        tr.appendChild(el("td", "num", (g.no || "") + "本目"));
        tr.appendChild(el("td", "bk-g-win", teamName(ctx, g.winner === "a" ? m.teamA : g.winner === "b" ? m.teamB : null)));
        tr.appendChild(el("td", "num", g.kills ? g.kills.a + " - " + g.kills.b : "─"));
        tr.appendChild(el("td", "num", g.points ? g.points.a + " - " + g.points.b : "─"));
        var tags = el("td", "bk-g-tags");
        if (g.overtime) tags.appendChild(el("span", "tag", "MIST式"));
        if (g.remakes) tags.appendChild(el("span", "bk-chip", "再試合 " + g.remakes + "回"));
        if (g.note) tags.appendChild(el("span", "bk-g-note", g.note));
        tr.appendChild(tags);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      var tw = el("div", "bk-games-wrap");
      tw.appendChild(tbl);
      dlg.appendChild(tw);
      dlg.appendChild(el("p", "bk-note", "Kill は実際の Kill 数、point は勝敗を決めた点数です（Kick ルール2 では残った相方の Kill が 2point）。左の数字が上のチームです。"));
    } else {
      dlg.appendChild(el("p", "bk-note", m.status === "live" ? "試合中です。結果が確定するとここに表示されます。" : "まだ試合前です。"));
    }

    if (!keep && !dlg.open) {
      if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    }
  }

  // ---------- エンジョイ賞金枠 ----------
  function renderAwards(ctx) {
    var a = ctx.d.awards;
    if (!a) return null;
    var clips = (a.bestClip || []).filter(function (c) { return c && c.displayName; });
    var pred = a.prediction || {};
    if (!clips.length && !pred.winnerTeamId) return null;
    var wrap = el("div", "bk-awards");
    wrap.appendChild(el("h3", "bk-sub", "エンジョイ賞金枠"));
    var grid = el("div", "grid-2");
    if (clips.length) {
      var b1 = el("div", "box");
      b1.appendChild(el("h3", null, "Bestクリップ賞"));
      var ul = el("ul", "bk-clips");
      clips.forEach(function (c) {
        var li = el("li");
        li.appendChild(el("span", "chip", CLIP_LABEL[c.category] || c.category || ""));
        li.appendChild(el("b", null, c.displayName));
        if (c.clipUrl && /^https:\/\//.test(c.clipUrl)) {
          var link = el("a", null, "クリップを見る");
          link.href = c.clipUrl; link.target = "_blank"; link.rel = "noopener";
          li.appendChild(link);
        }
        ul.appendChild(li);
      });
      b1.appendChild(ul);
      grid.appendChild(b1);
    }
    if (pred.winnerTeamId) {
      var b2 = el("div", "box");
      b2.appendChild(el("h3", null, "優勝者予想賞"));
      var p = el("p", "bk-pred");
      p.appendChild(el("span", null, "優勝 "));
      p.appendChild(el("b", null, teamName(ctx, pred.winnerTeamId)));
      b2.appendChild(p);
      if (pred.hitCount != null) {
        var p2 = el("p", "bk-pred");
        p2.appendChild(el("span", null, "的中 "));
        p2.appendChild(el("b", "num", pred.hitCount + "人"));
        if (pred.hitCount > 0) p2.appendChild(el("span", null, "（1人 約" + Math.floor(10000 / pred.hitCount).toLocaleString("ja-JP") + "円）"));
        b2.appendChild(p2);
      }
      grid.appendChild(b2);
    }
    wrap.appendChild(grid);
    return wrap;
  }

  refresh();
  if (DATA_URL) {
    setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refresh(); });
  }
})();
