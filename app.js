// CocktailShelf — ローカル日本語データから検索・表示
const DATA_URL = "data/cocktails.json";
const FAV_KEY  = "cocktailshelf:favs";
const WISH_KEY = "cocktailshelf:wishlist";

// DOM
const grid         = document.getElementById("grid");
const emptyMsg     = document.getElementById("emptyMsg");
const loader       = document.getElementById("loader");
const resultsTitle = document.getElementById("resultsTitle");
const resultsCount = document.getElementById("resultsCount");
const searchInput  = document.getElementById("searchInput");
const searchBtn    = document.getElementById("searchBtn");
const searchHint   = document.getElementById("searchHint");
const styleSel     = document.getElementById("styleSelect");
const baseSel      = document.getElementById("baseSelect");
const randomBtn    = document.getElementById("randomBtn");
const tabs         = document.querySelectorAll(".tab");
const modal        = document.getElementById("modal");
const modalBody    = document.getElementById("modalBody");

let DATA = [];          // 全カクテル（読み込み後固定）
let currentTab = "browse";

// --- お気に入り（押した回数カウンター） ---
// 形式: { "<id>": <count> }
// 旧形式（["id1", "id2"]）からの自動マイグレーションも行う
function getFavs() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(FAV_KEY)); }
  catch { raw = null; }
  if (Array.isArray(raw)) {
    // 旧形式 → 全部 1 票としてマイグレーション
    const obj = {};
    for (const id of raw) obj[String(id)] = 1;
    localStorage.setItem(FAV_KEY, JSON.stringify(obj));
    return obj;
  }
  return (raw && typeof raw === "object") ? raw : {};
}
function favCount(id) {
  return getFavs()[String(id)] || 0;
}
function isFav(id) {
  return favCount(id) > 0;
}
// ★ボタン押下: 必ず +1 加算（限りなく足せる）
function bumpFav(id) {
  const favs = getFavs();
  const sid = String(id);
  favs[sid] = (favs[sid] || 0) + 1;
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
  return favs[sid];
}
// 解除（×ボタン用）。0 にしてエントリ削除
function clearFav(id) {
  const favs = getFavs();
  delete favs[String(id)];
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

// --- 飲んでみたい（ウィッシュリスト） ---
// 形式: { "<id>": <addedAt(ms)> } — 追加順を保持するため timestamp を持つ
function getWish() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(WISH_KEY)); }
  catch { raw = null; }
  if (Array.isArray(raw)) {
    // 旧形式 → 現在時刻で揃える
    const now = Date.now();
    const obj = {};
    raw.forEach((id, i) => { obj[String(id)] = now - (raw.length - i); });
    localStorage.setItem(WISH_KEY, JSON.stringify(obj));
    return obj;
  }
  return (raw && typeof raw === "object") ? raw : {};
}
function isWish(id) { return !!getWish()[String(id)]; }
function toggleWish(id) {
  const wish = getWish();
  const sid = String(id);
  if (wish[sid]) delete wish[sid];
  else wish[sid] = Date.now();
  localStorage.setItem(WISH_KEY, JSON.stringify(wish));
  return !!wish[sid];
}

// --- ユーティリティ ---
function showLoader(on) {
  loader.classList.toggle("hidden", !on);
  if (on) grid.innerHTML = "";
  emptyMsg.classList.add("hidden");
}
function setTitle(text, count) {
  resultsTitle.textContent = text;
  resultsCount.textContent = (count != null) ? `${count} 件` : "";
}
function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}
// CSS class セーフな名前へ
function cssSafe(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
}

// 画像が無いときに見せるプレースホルダー
function makePlaceholder(c) {
  const div = document.createElement("div");
  div.className = `card-img placeholder ph-${cssSafe(c.style || "その他")}`;
  div.setAttribute("aria-label", c.name_ja || "");
  div.innerHTML = `
    <span class="ph-mark">◍</span>
    <span class="ph-name">${escapeHTML(c.name_ja || c.name_en || "")}</span>
  `;
  return div;
}
// カタカナ/ひらがな/英大小同一視
function normalize(s) {
  if (!s) return "";
  return s.toString().toLowerCase()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// --- スタイル判定（ショート/ロング/ロック等） ---
// グラス・カテゴリ・作り方の単語から推定。判定順は上が優先
function classifyStyle(c) {
  const glass = (c.glass_en || "").toLowerCase();
  const glassJa = c.glass_ja || "";
  const cat = (c.category_en || "").toLowerCase();
  const catJa = c.category_ja || "";
  const inst = ((c.instructions_en || "") + " " + (c.instructions_ja || "")).toLowerCase();
  const name = ((c.name_en || "") + " " + (c.name_ja || "")).toLowerCase();
  const nonAlc = (c.alcoholic_ja === "ノンアルコール");
  const hasIce = /\b(ice|iced|cold|chilled)\b|氷|アイス|冷や/.test(inst + " " + name);

  // 1. 明確なカテゴリ（ビール・パンチはロングに統合）
  if (cat.includes("beer") || catJa === "ビール") return "ロング";
  if (cat.includes("punch") || catJa.includes("パンチ")) return "ロング";
  if (cat.includes("soft") || catJa === "ソフトドリンク") return "ソフトドリンク";

  // 1.5. コーヒー（ノンアルコールのコーヒー系）
  const hasCoffeeIngredient = (c.ingredients || []).some(it => {
    const s = ((it.name_ja || "") + " " + (it.name_en || "")).toLowerCase();
    return /coffee|espresso|コーヒー|エスプレッソ/.test(s);
  });
  const isCoffeeContext = glass.includes("coffee") || glassJa.includes("コーヒー") ||
                          /coffee|espresso|コーヒー|エスプレッソ/.test(name) ||
                          hasCoffeeIngredient;
  if (nonAlc && isCoffeeContext) return "コーヒー";

  // 2. フローズン（blender 系のキーワードのみ。"crushed ice" は除外）
  if (/\b(blend|blender|frozen|frapp|slush|smoothie|シャーベット)\b/.test(inst) ||
      /\b(frozen|フローズン)\b/.test(name)) {
    return "フローズン";
  }

  // 3. ホット（コーヒー/アイリッシュコーヒー系で、アイス指定が無いものに限定）
  const isHotGlass = glass.includes("coffee") || glass.includes("irish coffee") ||
                     glassJa.includes("コーヒー") || glassJa.includes("アイリッシュコーヒー");
  const isHotInst = /\bboiling|boiled|steamed|simmer|piping hot|hot water|hot coffee|hot tea|温めた|沸かし/.test(inst);
  const isHotName = /\bhot\b|ホット|温かい/.test(name) && !/iced|cold|chilled|アイス|冷/.test(name);
  if ((isHotGlass && !hasIce) || isHotInst || isHotName) {
    return "ホット";
  }

  // 4. スパークリング
  if (glass.includes("flute") || glass.includes("champagne") ||
      glassJa.includes("フルート") || glassJa.includes("シャンパン")) {
    return "スパークリング";
  }

  // 5. ショット
  if (glass.includes("shot") || glassJa.includes("ショット") ||
      cat.includes("shot") || catJa === "ショット") {
    return "ショット";
  }

  // 6. ロック
  if (glass.includes("old-fashioned") || glass.includes("old fashioned") ||
      glass.includes("whiskey glass") || glass.includes("rocks") ||
      glassJa.includes("オールドファッションド") || glassJa.includes("ウイスキーグラス")) {
    return "ロック";
  }

  // 7. ロング
  if (glass.includes("highball") || glass.includes("collins") ||
      glass.includes("hurricane") || glass.includes("pint") ||
      glass.includes("pitcher") || glass.includes("mason") ||
      glass.includes("copper mug") || glass.includes("beer mug") ||
      glass.includes("punch bowl") || glass.includes("mug") ||
      glassJa.includes("ハイボール") || glassJa.includes("コリンズ") ||
      glassJa.includes("ハリケーン") || glassJa.includes("パイント") ||
      glassJa.includes("ピッチャー") || glassJa.includes("メイソン") ||
      glassJa.includes("銅マグ") || glassJa.includes("ビアマグ") ||
      glassJa.includes("パンチボウル") || glassJa.includes("マグ")) {
    return "ロング";
  }

  // 8. ショート（カクテルグラス系 + ブランデー/ワイン/プースカフェ等の小ぶりも含める）
  if (glass.includes("cocktail") || glass.includes("coupe") ||
      glass.includes("margarita") || glass.includes("nick and nora") ||
      glass.includes("whiskey sour") || glass.includes("martini") ||
      glass.includes("brandy") || glass.includes("snifter") ||
      glass.includes("cordial") || glass.includes("pousse") ||
      glass.includes("wine") || glass.includes("balloon") || glass.includes("parfait") ||
      glassJa.includes("カクテルグラス") || glassJa.includes("クープ") ||
      glassJa.includes("マルガリータグラス") || glassJa.includes("ニック") ||
      glassJa.includes("ウイスキーサワー") || glassJa.includes("ブランデー") ||
      glassJa.includes("コーディアル") || glassJa.includes("プースカフェ") ||
      glassJa.includes("ワイングラス") || glassJa.includes("バルーン") ||
      glassJa.includes("パフェ")) {
    return "ショート";
  }

  // 9. フォールバック
  if (nonAlc) return "ソフトドリンク";
  return "ショート";
}

// --- カード描画 ---
function renderCards(items, titleText) {
  if (titleText !== undefined) setTitle(titleText);
  grid.innerHTML = "";
  if (!items || items.length === 0) {
    emptyMsg.classList.remove("hidden");
    setTitle(resultsTitle.textContent, 0);
    return;
  }
  emptyMsg.classList.add("hidden");

  const frag = document.createDocumentFragment();
  for (const c of items) {
    const wrap = document.createElement("div");
    wrap.className = "card-wrap";

    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = c.id;

    let img;
    if (c.image) {
      img = document.createElement("img");
      img.className = "card-img";
      img.loading = "lazy";
      img.alt = c.name_ja;
      img.src = c.image;
      img.onerror = () => {
        if (c.image_remote) img.src = c.image_remote;
        else { img.replaceWith(makePlaceholder(c)); }
      };
    } else {
      img = makePlaceholder(c);
    }

    const body = document.createElement("div");
    body.className = "card-body";
    const en = c.name_en && c.name_en !== c.name_ja ? ` <span class="muted">/ ${escapeHTML(c.name_en)}</span>` : "";
    const styleBadge = c.style ? `<span class="style-badge style-${cssSafe(c.style)}">${escapeHTML(c.style)}</span>` : "";
    body.innerHTML = `
      <h3 class="card-name"></h3>
      <p class="card-meta">${styleBadge} <span class="muted">${escapeHTML(c.base || "")}</span></p>
    `;
    body.querySelector(".card-name").innerHTML = escapeHTML(c.name_ja) + en;

    card.append(img, body);
    card.addEventListener("click", () => openDetail(c.id));

    const favBtn = document.createElement("button");
    favBtn.className = "card-fav";
    favBtn.title = "お気に入り（押すたびに+1）";
    renderFavBtn(favBtn, c.id);
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      bumpFav(c.id);
      renderFavBtn(favBtn, c.id);
      if (currentTab === "favorites") loadFavorites();
    });

    const wishBtn = document.createElement("button");
    wishBtn.className = "card-wish";
    wishBtn.title = "飲んでみたい";
    renderWishBtn(wishBtn, c.id);
    wishBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleWish(c.id);
      renderWishBtn(wishBtn, c.id);
      if (currentTab === "wishlist") loadWishlist();
    });

    wrap.append(card, wishBtn, favBtn);

    // お気に入りタブ：解除ボタンを明示表示
    if (currentTab === "favorites") {
      const clrBtn = document.createElement("button");
      clrBtn.className = "card-clear";
      clrBtn.title = "お気に入りから外す";
      clrBtn.textContent = "×";
      clrBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        clearFav(c.id);
        loadFavorites();
      });
      wrap.appendChild(clrBtn);
    }
    // 飲んでみたいタブ：解除ボタンを明示表示
    if (currentTab === "wishlist") {
      const clrBtn = document.createElement("button");
      clrBtn.className = "card-clear";
      clrBtn.title = "飲んでみたいから外す";
      clrBtn.textContent = "×";
      clrBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleWish(c.id);
        loadWishlist();
      });
      wrap.appendChild(clrBtn);
    }

    frag.appendChild(wrap);
  }
  grid.appendChild(frag);
  setTitle(resultsTitle.textContent, items.length);
}

function renderFavBtn(btn, id) {
  const n = favCount(id);
  btn.classList.toggle("is-fav", n > 0);
  btn.innerHTML = n > 0
    ? `★<span class="fav-count">${n}</span>`
    : "☆";
}
function renderWishBtn(btn, id) {
  const on = isWish(id);
  btn.classList.toggle("is-wish", on);
  btn.title = on ? "飲んでみたいから外す" : "飲んでみたいに追加";
  btn.textContent = on ? "✓ 飲みたい" : "+ 飲みたい";
}

// --- 詳細モーダル ---
function openDetail(id) {
  const data = DATA.find(x => String(x.id) === String(id));
  if (!data) return;
  const cnt = favCount(id);
  const items = data.ingredients || [];

  const heroImg = data.image
    ? `<img src="${data.image}" onerror="this.onerror=null;this.src='${data.image_remote || ""}'" alt="">`
    : `<div class="detail-img placeholder ph-${cssSafe(data.style || "その他")}">
         <span class="ph-mark">◍</span><span class="ph-name">${escapeHTML(data.name_ja || "")}</span>
       </div>`;
  modalBody.innerHTML = `
    <div class="detail-hero">
      ${heroImg}
      <div>
        <h2 class="detail-title"></h2>
        <p class="detail-sub muted"></p>
        <div class="detail-tags">
          ${data.style ? `<span class="tag tag-style style-${cssSafe(data.style)}">${escapeHTML(data.style)}</span>` : ""}
          ${data.alcoholic_ja ? `<span class="tag">${escapeHTML(data.alcoholic_ja)}</span>` : ""}
          ${data.glass_ja ? `<span class="tag">${escapeHTML(data.glass_ja)}</span>` : ""}
          ${data.base ? `<span class="tag">${escapeHTML(data.base)} ベース</span>` : ""}
          ${data.iba ? `<span class="tag">IBA: ${escapeHTML(data.iba)}</span>` : ""}
        </div>
        <div class="fav-row">
          <button class="fav-toggle ${cnt > 0 ? "is-fav" : ""}" id="favToggle"></button>
          ${cnt > 0 ? '<button class="fav-clear" id="favClear" title="お気に入りから外す">解除</button>' : ""}
          <button class="wish-toggle ${isWish(id) ? "is-wish" : ""}" id="wishToggle"></button>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <h3>材料</h3>
      <ul class="ingredients">
        ${items.map(it => {
          const n = it.name_ja || it.name_en || "";
          return `
          <li>
            <span class="ing-link" data-name="${escapeHTML(n)}" title="この材料で検索">${escapeHTML(n)}</span>
            <span class="measure">${escapeHTML(it.measure_ja || it.measure_en || "")}</span>
          </li>`;
        }).join("")}
      </ul>
      <h3>作り方</h3>
      <p class="instructions"></p>
      ${data.credit ? `
        <p class="image-credit">
          画像: <a href="${escapeHTML(data.credit.source_url || "#")}" target="_blank" rel="noopener">${escapeHTML(data.credit.title || "")}</a>
          by ${escapeHTML(data.credit.artist || "Unknown")} /
          <span class="license">${escapeHTML(data.credit.license || "")}</span> via Wikimedia Commons
        </p>` : ""}
    </div>
  `;
  modalBody.querySelector(".detail-title").textContent = data.name_ja;
  modalBody.querySelector(".detail-sub").textContent = data.name_en;
  modalBody.querySelector(".instructions").textContent = data.instructions_ja || data.instructions_en || "";

  // 材料をクリックで AND 絞り込み候補に追加できる
  modalBody.querySelectorAll(".ingredients li .ing-link").forEach(el => {
    el.addEventListener("click", () => {
      const name = el.dataset.name;
      // 検索フォームに反映してブラウズタブで AND 検索
      document.querySelector('input[name="mode"][value="ingredient"]').checked = true;
      searchInput.value = name;
      switchTab("browse");
      applyFilters();
      closeDetail();
    });
  });

  const updateFavUI = () => {
    const n = favCount(id);
    const favBtn = modalBody.querySelector("#favToggle");
    favBtn.classList.toggle("is-fav", n > 0);
    favBtn.innerHTML = n > 0 ? `★ お気に入り <span class="fav-count">${n}</span>` : "☆ お気に入りに追加";
    // 解除ボタンの出し入れ
    const row = modalBody.querySelector(".fav-row");
    let clr = row.querySelector("#favClear");
    if (n > 0 && !clr) {
      clr = document.createElement("button");
      clr.className = "fav-clear";
      clr.id = "favClear";
      clr.title = "お気に入りから外す";
      clr.textContent = "解除";
      clr.addEventListener("click", () => {
        clearFav(id);
        updateFavUI();
        // カード側の表示も更新
        const cardFav = grid.querySelector(`.card[data-id="${id}"]`)?.parentElement.querySelector(".card-fav");
        if (cardFav) renderFavBtn(cardFav, id);
        if (currentTab === "favorites") loadFavorites();
      });
      row.appendChild(clr);
    } else if (n === 0 && clr) {
      clr.remove();
    }
  };
  updateFavUI();
  modalBody.querySelector("#favToggle").addEventListener("click", () => {
    bumpFav(id);
    updateFavUI();
    const cardFav = grid.querySelector(`.card[data-id="${id}"]`)?.parentElement.querySelector(".card-fav");
    if (cardFav) renderFavBtn(cardFav, id);
  });

  // 飲んでみたいトグル
  const wishToggle = modalBody.querySelector("#wishToggle");
  const renderWishToggle = () => {
    const on = isWish(id);
    wishToggle.classList.toggle("is-wish", on);
    wishToggle.textContent = on ? "✓ 飲んでみたい" : "+ 飲んでみたい";
  };
  renderWishToggle();
  wishToggle.addEventListener("click", () => {
    toggleWish(id);
    renderWishToggle();
    const cardWish = grid.querySelector(`.card[data-id="${id}"]`)?.parentElement.querySelector(".card-wish");
    if (cardWish) renderWishBtn(cardWish, id);
    if (currentTab === "wishlist") loadWishlist();
  });

  modal.classList.remove("hidden");
}
function closeDetail() { modal.classList.add("hidden"); }

modal.addEventListener("click", (e) => {
  if (e.target.dataset.close !== undefined) closeDetail();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
});

// --- 検索／フィルタ ---
function searchByName(q) {
  const nq = normalize(q);
  return DATA.filter(c =>
    normalize(c.name_ja).includes(nq) || normalize(c.name_en).includes(nq)
  );
}
// 単一トークンが材料に含まれるか
function cocktailHasIngredient(c, token) {
  const t = normalize(token);
  return (c.ingredients || []).some(it =>
    normalize(it.name_ja).includes(t) || normalize(it.name_en).includes(t)
  );
}
// AND 検索：全トークンを含むカクテルだけを返す
function searchByIngredientsAND(tokens) {
  return DATA.filter(c => tokens.every(t => cocktailHasIngredient(c, t)));
}

// 入力文字列を「,」「、」「 」「+」「&」で分割してトークン配列に
function tokenizeIngredients(q) {
  return q.split(/[,、\s+&]+/).map(s => s.trim()).filter(Boolean);
}

// すべてのフィルター（検索文字列・スタイル・ベース）を AND で適用
function applyFilters() {
  let items = DATA.slice();
  const labels = [];

  // 検索文字列
  const q = searchInput.value.trim();
  if (q) {
    const mode = document.querySelector('input[name="mode"]:checked').value;
    if (mode === "name") {
      items = searchByNameFrom(items, q);
      labels.push(`名前「${q}」`);
    } else {
      const tokens = tokenizeIngredients(q);
      if (tokens.length > 0) {
        items = items.filter(c => tokens.every(t => cocktailHasIngredient(c, t)));
        labels.push(`材料 ${tokens.map(t => `「${t}」`).join(" & ")}`);
      }
    }
  }

  // スタイル
  if (styleSel.value) {
    items = items.filter(c => c.style === styleSel.value);
    labels.push(`${styleSel.value} スタイル`);
  }

  // ベース
  if (baseSel.value) {
    const baseLabel = baseSel.options[baseSel.selectedIndex].textContent;
    items = items.filter(c => c.base === baseSel.value);
    labels.push(`${baseLabel} ベース`);
  }

  if (labels.length === 0) {
    loadInitial();
    return;
  }
  renderCards(items, labels.join(" × "));
}

// 与えられた配列内で名前検索
function searchByNameFrom(arr, q) {
  const nq = normalize(q);
  return arr.filter(c =>
    normalize(c.name_ja).includes(nq) || normalize(c.name_en).includes(nq)
  );
}

// インクリメンタル検索の debounce
let searchTimer = null;
function debouncedSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilters, 200);
}

// 旧 API（互換用） — どれも applyFilters に委譲
function loadBase() { applyFilters(); }
function loadStyle() { applyFilters(); }

function loadInitial() {
  // 人気どころを優先表示。残りはランダム
  const popular = [
    "11007","11000","11003","11001","11002","11004","11005","11006",
    "11008","11009","11118","11119","11410","11411","11728"
  ];
  const head = [];
  for (const id of popular) {
    const f = DATA.find(c => c.id === id);
    if (f) head.push(f);
  }
  const rest = DATA.filter(c => !popular.includes(c.id));
  // シャッフル
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  renderCards([...head, ...rest], "すべてのカクテル");
}

function loadFavorites() {
  const favs = getFavs();
  // 押下回数の降順 → 同数なら ID 順
  const entries = Object.entries(favs)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const items = entries
    .map(([id]) => DATA.find(c => String(c.id) === String(id)))
    .filter(Boolean);
  renderCards(items, "お気に入り");
}

function loadWishlist() {
  const wish = getWish();
  // 追加が新しいものを上に
  const entries = Object.entries(wish).sort((a, b) => b[1] - a[1]);
  const items = entries
    .map(([id]) => DATA.find(c => String(c.id) === String(id)))
    .filter(Boolean);
  renderCards(items, "飲んでみたい");
}

// --- 材料一覧（頻出順） ---
function buildIngredientStats() {
  // key: name_ja, value: {ja, en, count}
  const map = new Map();
  for (const c of DATA) {
    for (const it of (c.ingredients || [])) {
      const ja = (it.name_ja || it.name_en || "").trim();
      if (!ja) continue;
      const key = ja;
      const prev = map.get(key);
      if (prev) prev.count++;
      else map.set(key, { ja, en: it.name_en || "", count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.ja.localeCompare(b.ja, "ja"));
}

function renderIngredients() {
  const list = buildIngredientStats();
  setTitle("材料一覧（頻出順）", list.length);
  grid.innerHTML = "";
  emptyMsg.classList.add("hidden");

  const wrap = document.createElement("div");
  wrap.className = "ing-grid";
  for (const it of list) {
    const chip = document.createElement("button");
    chip.className = "ing-chip";
    chip.innerHTML = `
      <span class="ing-name">${escapeHTML(it.ja)}</span>
      <span class="ing-count">${it.count}</span>
    `;
    chip.title = `${it.ja} を使うカクテルを表示`;
    chip.addEventListener("click", () => {
      document.querySelector('input[name="mode"][value="ingredient"]').checked = true;
      searchInput.value = it.ja;
      switchTab("browse");
      applyFilters();
    });
    wrap.appendChild(chip);
  }
  grid.appendChild(wrap);
}

function switchTab(name) {
  tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === name));
  currentTab = name;
  if (name === "favorites") loadFavorites();
  else if (name === "wishlist") loadWishlist();
  else if (name === "ingredients") renderIngredients();
  else loadInitial();
}

function loadRandom() {
  const pick = DATA[Math.floor(Math.random() * DATA.length)];
  if (!pick) return;
  renderCards([pick], "ランダムピック");
  openDetail(pick.id);
}

// --- 起動 ---
async function init() {
  showLoader(true);
  try {
    const res = await fetch(DATA_URL);
    DATA = await res.json();
    // 各カクテルにスタイル属性を付与
    for (const c of DATA) c.style = classifyStyle(c);
    loadInitial();
  } catch (e) {
    setTitle("データの読み込みに失敗");
    renderCards([]);
    console.error(e);
  } finally {
    showLoader(false);
  }
}

// イベント配線
searchBtn.addEventListener("click", applyFilters);
searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
searchInput.addEventListener("input", debouncedSearch);
document.querySelectorAll('input[name="mode"]').forEach(r => {
  r.addEventListener("change", () => {
    const m = document.querySelector('input[name="mode"]:checked').value;
    searchHint.textContent = m === "name"
      ? "カクテル名で検索（日本語/英語どちらでも）"
      : "材料名で AND 検索。複数は空白かカンマで区切る（例: ジン トニック）";
    searchInput.placeholder = m === "name" ? "例: マルガリータ" : "例: ジン トニック";
    if (searchInput.value.trim()) applyFilters();
  });
});
styleSel.addEventListener("change", applyFilters);
baseSel.addEventListener("change", applyFilters);
randomBtn.addEventListener("click", loadRandom);
tabs.forEach(t => t.addEventListener("click", () => switchTab(t.dataset.tab)));

init();
