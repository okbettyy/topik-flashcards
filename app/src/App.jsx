import { useEffect, useMemo, useState } from "react";
import "./App.css";
import Papa from "papaparse";
import { get, set, del } from "idb-keyval";

const DB_KEY = "topik_flashcards_v1";
const STATS_KEY = "topik_stats_v1";
const MIN_EASE = 1.3;

const POS_LABELS = {
  명: { ko: "명사", en: "Noun" },
  동: { ko: "동사", en: "Verb" },
  형: { ko: "형용사", en: "Adjective" },
  부: { ko: "부사", en: "Adverb" },
  의: { ko: "의존명사", en: "Dependent noun" },
  관: { ko: "관형사", en: "Determiner" },
  대: { ko: "대명사", en: "Pronoun" },
  감: { ko: "감탄사", en: "Interjection" },
  수: { ko: "수사", en: "Numeral" },
  접: { ko: "접속사", en: "Conjunction" },
  보: { ko: "보조용언", en: "Auxiliary" },
};

const POS_FILTERS = ["all", "명", "동", "형", "부", "보", "의"];
const LEVEL_FILTERS = ["all", "A", "B", "C"];

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function stripSenseSuffix(word) {
  const s = String(word ?? "").trim();
  return s.replace(/([가-힣])\d{2}$/, "$1");
}

function normalizeAnswer(s) {
  return String(s ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

function levenshtein(a, b) {
  const s = normalizeAnswer(a);
  const t = normalizeAnswer(b);
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[n][m];
}

function isCloseMatch(typed, answer) {
  const a = normalizeAnswer(answer);
  const t = normalizeAnswer(typed);
  if (!t) return false;
  if (t === a) return true;

  const dist = levenshtein(t, a);
  const tol = a.length >= 6 ? 2 : 1;
  return dist <= tol;
}

function grammarNote(card) {
  if (card.pos === "보") {
    return {
      title: "보조용언 (Auxiliary)",
      body:
        "앞 동사/형용사 뒤에 붙어서 의미를 더해요.\n" +
        "패턴: (V/A-아/어) + 보조용언\n" +
        "예: 해 갖다 / 먹어 갖다 / 써 갖다",
    };
  }
  return null;
}

function autoExamples(card) {
  const w = stripSenseSuffix(card.rawWord ?? card.word);
  const meaning = (card.hanja || "").trim();

  if (card.pos === "동") return [`${w}요.`, `저는 ${w}.`, meaning ? `(${meaning})` : null].filter(Boolean);
  if (card.pos === "형") return [`이거 ${w}.`, `정말 ${w}.`, meaning ? `(${meaning})` : null].filter(Boolean);
  if (card.pos === "부") return [`${w} 가요.`, `${w} 해요.`, meaning ? `(${meaning})` : null].filter(Boolean);
  if (card.pos === "보") return [`해 ${w}요.`, `먹어 ${w}요.`, `써 ${w}요.`, meaning ? `(${meaning})` : null].filter(Boolean);
  return meaning ? [meaning] : [];
}

function addMinutes(ts, minutes) {
  return ts + minutes * 60 * 1000;
}
function addHours(ts, hours) {
  return ts + hours * 60 * 60 * 1000;
}
function addDays(ts, days) {
  return ts + days * 24 * 60 * 60 * 1000;
}

function reviewCard(card, action, now = Date.now()) {
  let c = { ...card };

  c.ease ??= 2.5;
  c.intervalDays ??= 0;
  c.reps ??= 0;
  c.lapses ??= 0;
  c.state ??= "new";
  c.due ??= now;

  if (action === "again") {
    c.lapses += 1;
    c.reps = 0;
    c.intervalDays = 0;
    c.ease = Math.max(MIN_EASE, c.ease - 0.2);
    c.state = "learning";
    c.due = addMinutes(now, 10);
    return c;
  }

  if (action === "learning") {
    c.state = "learning";
    c.reps = Math.min(c.reps + 1, 2);
    c.due = addHours(now, 6);
    return c;
  }

  c.reps += 1;

  if (c.intervalDays <= 0) c.intervalDays = 1;
  else if (c.intervalDays === 1) c.intervalDays = 3;
  else c.intervalDays = Math.round(c.intervalDays * c.ease);

  c.ease += 0.05;
  c.state = "known";
  c.due = addDays(now, c.intervalDays);
  return c;
}

function isDue(card, now = Date.now()) {
  return (card.due ?? 0) <= now;
}

export default function App() {
  const [cards, setCards] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [mode, setMode] = useState("due"); // due | learning | known | all | knownPage
  const [flipped, setFlipped] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [posFilter, setPosFilter] = useState("all");
  const [includeAux, setIncludeAux] = useState(true);

  const [typingMode, setTypingMode] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedResult, setTypedResult] = useState(null);

  const [knownSearch, setKnownSearch] = useState("");
  const [todayStats, setTodayStats] = useState(null);

  async function resetAll() {
    await del(DB_KEY);
    await del(STATS_KEY);
    setCards([]);
    setMode("due");
    setActiveId(null);
    setFlipped(false);
    setTyped("");
    setTypedResult(null);
    setTodayStats(null);
  }

  async function loadStats() {
    const saved = await get(STATS_KEY);
    const key = todayKey();
    if (saved?.date !== key) {
      const fresh = { date: key, reviewed: 0, correct: 0, byPos: {} };
      await set(STATS_KEY, fresh);
      setTodayStats(fresh);
      return;
    }
    setTodayStats(saved ?? { date: key, reviewed: 0, correct: 0, byPos: {} });
  }

  async function bumpStats({ pos, correct }) {
    const key = todayKey();
    const saved = (await get(STATS_KEY)) ?? { date: key, reviewed: 0, correct: 0, byPos: {} };
    const base = saved?.date === key ? saved : { date: key, reviewed: 0, correct: 0, byPos: {} };

    const p = pos || "?";
    const byPos = { ...(base.byPos ?? {}) };
    const cur = byPos[p] ?? { reviewed: 0, correct: 0 };
    cur.reviewed += 1;
    if (correct) cur.correct += 1;
    byPos[p] = cur;

    const next = {
      date: key,
      reviewed: (base.reviewed ?? 0) + 1,
      correct: (base.correct ?? 0) + (correct ? 1 : 0),
      byPos,
    };

    await set(STATS_KEY, next);
    setTodayStats(next);
  }

  useEffect(() => {
    (async () => {
      const saved = await get(DB_KEY);
      if (saved?.cards?.length) {
        setCards(saved.cards);
        setMode(saved.mode ?? "due");
        setActiveId(saved.activeId ?? saved.cards[0]?.id ?? null);

        setSearch(saved.search ?? "");
        setLevelFilter(saved.levelFilter ?? "all");
        setPosFilter(saved.posFilter ?? "all");
        setIncludeAux(saved.includeAux ?? true);
        setTypingMode(saved.typingMode ?? false);
      }
      await loadStats();
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      await set(DB_KEY, {
        cards,
        mode,
        activeId,
        search,
        levelFilter,
        posFilter,
        includeAux,
        typingMode,
      });
    })();
  }, [cards, mode, activeId, search, levelFilter, posFilter, includeAux, typingMode, loaded]);

  const stats = useMemo(() => {
    const now = Date.now();
    return {
      due: cards.filter((c) => isDue(c, now)).length,
      learning: cards.filter((c) => c.state === "learning").length,
      known: cards.filter((c) => c.state === "known").length,
      total: cards.length,
    };
  }, [cards]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (!includeAux && c.pos === "보") return false;
      if (levelFilter !== "all" && String(c.level || "").trim() !== levelFilter) return false;
      if (posFilter !== "all" && String(c.pos || "").trim() !== posFilter) return false;

      if (!q) return true;
      const hay = `${c.word ?? ""} ${c.rawWord ?? ""} ${c.hanja ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [cards, search, includeAux, levelFilter, posFilter]);

  const queue = useMemo(() => {
    const now = Date.now();
    if (mode === "due") return filteredCards.filter((c) => isDue(c, now));
    if (mode === "learning") return filteredCards.filter((c) => c.state === "learning");
    if (mode === "known") return filteredCards.filter((c) => c.state === "known");
    if (mode === "all") return filteredCards;
    return [];
  }, [filteredCards, mode]);

  const activeCard = useMemo(() => {
    if (!queue.length) return null;
    return queue.find((c) => c.id === activeId) ?? queue[0];
  }, [queue, activeId]);

  const knownCount = useMemo(() => cards.filter((c) => c.state === "known").length, [cards]);
  const learnedPct = cards.length ? Math.round((knownCount / cards.length) * 100) : 0;
  const queuePct = queue.length ? Math.round(((queueIndex + 1) / queue.length) * 100) : 0;

  function goToIndex(nextIdx) {
    if (!queue.length) return;
    const clamped = (nextIdx + queue.length) % queue.length;
    setQueueIndex(clamped);
    setActiveId(queue[clamped].id);
    setFlipped(false);
    setTyped("");
    setTypedResult(null);
  }
  function nextCard() { goToIndex(queueIndex + 1); }
  function prevCard() { goToIndex(queueIndex - 1); }

  useEffect(() => {
    if (!queue.length) {
      setActiveId(null);
      setQueueIndex(0);
      setFlipped(false);
      setTyped("");
      setTypedResult(null);
      return;
    }
    const idx = activeId ? queue.findIndex((c) => c.id === activeId) : -1;
    const resolved = idx >= 0 ? idx : 0;

    setQueueIndex(resolved);
    setActiveId(queue[resolved].id);
    setFlipped(false);
    setTyped("");
    setTypedResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // keyboard shortcuts (don’t steal typing)
  useEffect(() => {
    function onKeyDown(e) {
      const tag = (e.target?.tagName || "").toLowerCase();
      const typingInInput = tag === "input" || tag === "textarea";
      if (typingInInput) return;

      if (mode === "knownPage") return;
      if (!activeCard) return;

      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((v) => !v);
        return;
      }
      if (e.key === "1") return act("again");
      if (e.key === "2") return act("learning");
      if (e.key === "3") return act("known");
      if (e.key === "ArrowRight") return nextCard();
      if (e.key === "ArrowLeft") return prevCard();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard, queueIndex, queue.length, mode]);

  function importCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const now = Date.now();
        const parsed = (res.data ?? [])
          .filter((r) => r["단어"])
          .map((r) => {
            const rawWord = String(r["단어"] ?? "").trim();
            const displayWord = stripSenseSuffix(rawWord);

            return {
              id: `${r["순위"]}-${rawWord}`,
              word: displayWord,
              rawWord,
              pos: String(r["품사"] ?? "").trim(),
              hanja: String(r["풀이"] ?? "").trim(),
              level: String(r["등급"] ?? "").trim(),
              rank: Number(r["순위"]),
              state: "new",
              due: now,
              intervalDays: 0,
              ease: 2.5,
              reps: 0,
              lapses: 0,
            };
          });

        setCards(parsed);
        setMode("due");
        setActiveId(parsed[0]?.id ?? null);
        setQueueIndex(0);
        setFlipped(false);
        setTyped("");
        setTypedResult(null);
      },
    });

    e.target.value = "";
  }

  async function act(action) {
    if (!activeCard) return;
    const updated = reviewCard(activeCard, action);
    setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setFlipped(false);
    setTyped("");
    setTypedResult(null);
    await bumpStats({ pos: activeCard.pos, correct: action !== "again" });
  }

  function submitTyping(e) {
    e.preventDefault();
    if (!activeCard) return;

    const ok = normalizeAnswer(typed) === normalizeAnswer(activeCard.word);
    const close = !ok && isCloseMatch(typed, activeCard.word);

    setTypedResult({ ok, close });
    setFlipped(true);
    bumpStats({ pos: activeCard.pos, correct: ok || close });
  }

  function resetOneCard(id) {
    const now = Date.now();
    setCards((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, state: "new", due: now, intervalDays: 0, reps: 0, lapses: 0, ease: 2.5 }
          : c
      )
    );
  }

  const posInfo =
    activeCard && (POS_LABELS[activeCard.pos] ?? { ko: activeCard.pos || "?", en: "" });

  const todayAccuracy = useMemo(() => {
    const r = todayStats?.reviewed ?? 0;
    const c = todayStats?.correct ?? 0;
    return r ? Math.round((c / r) * 100) : 0;
  }, [todayStats]);

  const knownList = useMemo(() => {
    const q = knownSearch.trim().toLowerCase();
    return cards
      .filter((c) => c.state === "known")
      .filter((c) => (includeAux ? true : c.pos !== "보"))
      .filter((c) => {
        if (!q) return true;
        const hay = `${c.word ?? ""} ${c.rawWord ?? ""} ${c.hanja ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  }, [cards, knownSearch, includeAux]);

  return (
    <div className="app">
      <div className="shell">
        {/* TOP BAR */}
        <div className="topbar">
          <div className="title">TOPIK Flashcards</div>
          <label className="import">
            Import CSV
            <input type="file" accept=".csv" hidden onChange={importCsv} />
          </label>
        </div>

        {/* STATS */}
        <div className="meta">
          <div className="stats">
            Due: {stats.due} · Learning: {stats.learning} · Known: {stats.known} · Total:{" "}
            {stats.total}
          </div>
          <div className="pillRow">
            <span className="pill">Today: <b>{todayStats?.reviewed ?? 0}</b></span>
            <span className="pill">Accuracy: <b>{todayAccuracy}%</b></span>
          </div>
        </div>

        <div className="controls">
          <input
            className="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search (word / 풀이)…"
          />

          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
            {LEVEL_FILTERS.map((x) => (
              <option key={x} value={x}>
                등급: {x === "all" ? "All" : x}
              </option>
            ))}
          </select>

          <select value={posFilter} onChange={(e) => setPosFilter(e.target.value)}>
            {POS_FILTERS.map((x) => (
              <option key={x} value={x}>
                품사: {x === "all" ? "All" : x}
              </option>
            ))}
          </select>

          <label className="toggle">
            <input type="checkbox" checked={includeAux} onChange={(e) => setIncludeAux(e.target.checked)} />
            Include 보조용언
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={typingMode}
              onChange={(e) => {
                setTypingMode(e.target.checked);
                setTyped("");
                setTypedResult(null);
                setFlipped(false);
              }}
            />
            Typing mode
          </label>
        </div>

        <div className="progressWrap">
          <div className="progressLabel">
            Queue: <b>{queue.length ? `${queueIndex + 1}/${queue.length}` : "0/0"}</b>
          </div>
          <div className="progressBar">
            <div className="progressFill" style={{ width: `${queuePct}%` }} />
          </div>

          <div className="progressLabel" style={{ marginTop: 10 }}>
            Learned: <b>{knownCount}/{cards.length}</b> ({learnedPct}%)
          </div>
          <div className="progressBar">
            <div className="progressFill" style={{ width: `${learnedPct}%` }} />
          </div>
        </div>

        {/* MODE ROW */}
       <div className="modeRow">
          <button className="resetBtn" onClick={resetAll}>Reset</button>

          <div className="segmented">
            <button className={mode === "due" ? "active" : ""} onClick={() => setMode("due")}>Due</button>
            <button className={mode === "learning" ? "active" : ""} onClick={() => setMode("learning")}>Learning</button>
            <button className={mode === "known" ? "active" : ""} onClick={() => setMode("known")}>Known</button>
            <button className={mode === "all" ? "active" : ""} onClick={() => setMode("all")}>All</button>
            <button className={mode === "knownPage" ? "active" : ""} onClick={() => setMode("knownPage")}>Known Cards</button>
          </div>
        </div>

        {/* MAIN AREA */}
        <div className="mainArea">
          {mode === "knownPage" ? (
            <div className="knownPage">
              <div className="knownHeader">
                <h2>Known cards</h2>
                <input
                  className="search"
                  value={knownSearch}
                  onChange={(e) => setKnownSearch(e.target.value)}
                  placeholder="Search known…"
                />
              </div>

              <div className="knownList">
                {knownList.map((c) => (
                  <div key={c.id} className="knownRow">
                    <div className="knownMain">
                      <div className="knownWord">{c.word}</div>
                      <div className="knownMeta">
                        {c.level || "?"} · {c.pos || "?"} · {c.hanja || ""}
                      </div>
                    </div>
                    <button className="resetBtn" onClick={() => resetOneCard(c.id)}>Reset</button>
                  </div>
                ))}
                {!knownList.length && <p>No known cards found.</p>}
              </div>
            </div>
          ) : activeCard ? (
            <>
              <div
                className={`card flipCard ${flipped ? "isFlipped" : ""}`}
                onClick={() => setFlipped((v) => !v)}
              >
                <div className="flipInner">
                  {/* FRONT */}
                  <div className="flipFace">
                    <div className="badge badgeLeft">
                      <div className="badgeKo">{activeCard.pos || "?"}</div>
                      <div className="badgeEn">{posInfo?.en || ""}</div>
                    </div>

                    <div className="badge badgeRight">
                      <div className="badgeKo">{activeCard.level || "?"}</div>
                      <div className="badgeEn">Level</div>
                    </div>

                    {typingMode ? (
                      <div className="typingBox" onClick={(e) => e.stopPropagation()}>
                        <div className="typingPrompt">{activeCard.hanja || "No 풀이"}</div>
                        <form onSubmit={submitTyping} className="typingForm">
                          <input
                            className="typingInput"
                            value={typed}
                            onChange={(e) => setTyped(e.target.value)}
                            placeholder="Type the Korean word…"
                            autoComplete="off"
                          />
                          <button className="miniBtn" type="submit">Check</button>
                        </form>

                        {typedResult && (
                          <div className={`typingResult ${typedResult.ok ? "ok" : typedResult.close ? "close" : "bad"}`}>
                            {typedResult.ok ? "✅ Correct" : typedResult.close ? "🟨 Close match" : "❌ Wrong"}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="front">{activeCard.word}</div>
                    )}
                  </div>

                  {/* BACK */}
                  <div className="flipFace flipBack">
                    <div className="backWrap">
                      <div className="backMain">
                      
                          <>
                            <div className="muted" style={{ marginBottom: 6 }}>Answer</div>
                            {activeCard.word}
                          </>
                          {activeCard.hanja || <span className="muted">No 풀이</span>}
                      </div>

                      {(() => {
                        const note = grammarNote(activeCard);
                        if (!note) return null;
                        return (
                          <div className="note">
                            <div className="noteTitle">{note.title}</div>
                            <div className="noteBody">{note.body}</div>
                          </div>
                        );
                      })()}

                      {(() => {
                        const ex = autoExamples(activeCard);
                        if (!ex.length) return null;
                        return (
                          <div className="examples">
                            <div className="examplesTitle">Examples</div>
                            <ul>
                              {ex.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="buttons">
                <button onClick={() => act("again")} className="danger">Again (1)</button>
                <button onClick={() => act("learning")} className="neutral">Learning (2)</button>
                <button onClick={() => act("known")} className="good">Known (3)</button>
              </div>

              <div className="navRow">
                <button className="miniBtn" onClick={prevCard}>← Prev</button>
                <button className="miniBtn" onClick={nextCard}>Next →</button>
              </div>
            </>
          ) : (
            <p>{cards.length ? "No cards in this mode (or filters removed them)." : "Import your CSV to begin."}</p>
          )}
        </div>
      </div>
    </div>
  );
}
