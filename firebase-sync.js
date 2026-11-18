/* 溪影尋蹤 Firebase：跨裝置房間與等待室同步（第一階段） */
(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyCUy01932rB8Lp8CAWeVwpY3RdIEPHaCIo",
    authDomain: "river-shadows.firebaseapp.com",
    databaseURL: "https://river-shadows-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "river-shadows",
    storageBucket: "river-shadows.firebasestorage.app",
    messagingSenderId: "97704809301",
    appId: "1:97704809301:web:c15513730c86691b20d5dc",
    measurementId: "G-QGRJGHNPB3"
  };

  // 測試開關：true 時允許房主單人開始；正式多人規則仍為 4～6 人。
  const SINGLE_PLAYER_TEST_MODE = true;
  const MIN_PLAYERS_TO_START = SINGLE_PLAYER_TEST_MODE ? 1 : 4;

  let db, auth, roomListener = null, serverTimeOffset = 0;
  const online = { uid: null, roomCode: null, isHost: false, players: [], connected: false };

  function notify(message) {
    if (typeof toast === "function") toast(message);
    else alert(message);
  }
  function safeName(value) {
    return String(value || "玩家").trim().slice(0, 10) || "玩家";
  }
  function makeCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }
  function stopRoomListener() {
    if (roomListener && online.roomCode) {
      db.ref(`rooms/${online.roomCode}`).off("value", roomListener);
    }
    roomListener = null;
  }
  function showConnection() {
    const top = document.querySelector(".topbar");
    if (!top || document.getElementById("firebaseStatus")) return;
    const el = document.createElement("span");
    el.id = "firebaseStatus";
    el.textContent = "連線中";
    el.style.cssText = "font-size:10px;color:#b9e4cf;margin-right:8px;white-space:nowrap";
    top.insertBefore(el, top.lastElementChild);
    firebase.database().ref(".info/connected").on("value", snap => {
      online.connected = snap.val() === true;
      el.textContent = online.connected ? "● 已連線" : "○ 離線";
      el.style.color = online.connected ? "#b9e4cf" : "#ffd2a8";
    });
  }
  async function init() {
    if (!window.firebase) throw new Error("Firebase SDK 載入失敗，請確認網路連線");
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.database();
    db.ref(".info/serverTimeOffset").on("value", snap => { serverTimeOffset = Number(snap.val() || 0); });
    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    const credential = await auth.signInAnonymously();
    online.uid = credential.user.uid;
    showConnection();
    console.info("[溪影尋蹤] Firebase 匿名登入完成", online.uid);
  }
  const ready = init().catch(err => {
    console.error("[溪影尋蹤] Firebase 初始化失敗", err);
    notify("Firebase 連線失敗：" + (err.message || err));
    throw err;
  });

  async function createOnlineRoom() {
    await ready;
    const name = safeName(document.getElementById("hostName")?.value);
    const maxPlayers = Number(document.getElementById("count")?.value || 4);
    let code, ref, snap, attempts = 0;
    do {
      code = makeCode();
      ref = db.ref(`rooms/${code}`);
      snap = await ref.once("value");
      attempts++;
    } while (snap.exists() && attempts < 8);
    if (snap.exists()) throw new Error("暫時無法產生房號，請再試一次");
    const player = { uid: online.uid, name, host: true, joinedAt: firebase.database.ServerValue.TIMESTAMP, ready: true };
    await ref.set({
      code, hostUid: online.uid, status: "lobby", maxPlayers,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      players: { [online.uid]: player },
      publicGame: { phase: "lobby", message: "等待玩家加入" }
    });
    online.roomCode = code;
    online.isHost = true;
    state.room = code;
    state.players = [{ name, host: true, uid: online.uid, cards: [], main: null, hidden: null, hint: "", guessesA: 0, guessedHidden: false, routeB: [], bTarget: null, bMainCorrect: false, bHiddenCorrect: false, swaps: 0, replaced: false }];
    state.me = 0;
    watchRoom();
    setScreen("lobby");
    notify("已建立線上房間，請分享 6 位數房號");
  }

  async function joinOnlineRoom() {
    await ready;
    const code = String(document.getElementById("joinCode")?.value || "").trim().toUpperCase();
    const name = safeName(document.getElementById("joinName")?.value);
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return notify("請輸入正確的 6 位數房間代碼");
    const ref = db.ref(`rooms/${code}`);
    const snap = await ref.once("value").catch(() => null);
    if (!snap || !snap.exists()) return notify("找不到房間，請確認房號");
    const room = snap.val();
    if (room.status !== "lobby") return notify("這個房間已經開始遊戲");
    const current = Object.keys(room.players || {}).length;
    if (current >= Number(room.maxPlayers || 6)) return notify("房間人數已滿");
    if (room.players?.[online.uid]) return notify("你已經在這個房間內");
    await ref.child(`players/${online.uid}`).set({
      uid: online.uid, name, host: false,
      joinedAt: firebase.database.ServerValue.TIMESTAMP, ready: true
    });
    online.roomCode = code;
    online.isHost = false;
    state.room = code;
    state.me = 0;
    closeModal();
    watchRoom();
    setScreen("lobby");
    notify("成功加入線上房間");
  }

  function watchRoom() {
    stopRoomListener();
    if (!online.roomCode) return;
    roomListener = snap => {
      if (!snap.exists()) {
        notify("房間已不存在");
        stopRoomListener();
        setScreen("home");
        return;
      }
      const room = snap.val();
      const rows = Object.values(room.players || {}).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
      online.players = rows;
      online.isHost = room.hostUid === online.uid;
      state.room = online.roomCode;
      state.players = rows.map(p => ({
        uid: p.uid, name: p.name, host: p.uid === room.hostUid,
        cards: [], main: null, hidden: null, hint: "",
        guessesA: 0, guessedHidden: false, routeB: [],
        bTarget: null, bMainCorrect: false, bHiddenCorrect: false,
        swaps: 0, replaced: false
      }));
      state.me = Math.max(0, rows.findIndex(p => p.uid === online.uid));
      if (state.screen === "lobby") renderOnlineLobby(room);
      if (room.status === "playing" && room.publicGame?.phase === "reading" && state.screen === "lobby") {
        startOnlineReading(room.publicGame.startedAt || (Date.now() + serverTimeOffset));
      }
      if (room.status === "playing" && room.publicGame?.phase === "game" && state.screen === "reading") {
        completeOnlineStart();
      }
    };
    db.ref(`rooms/${online.roomCode}`).on("value", roomListener, err => {
      console.error(err);
      notify("讀取房間失敗：" + err.message);
    });
  }

  function startOnlineReading(startedAt) {
    if (state.screen !== "lobby") return;
    clearInterval(state.timer);
    const duration = 20;
    const update = () => {
      const serverNow = Date.now() + serverTimeOffset;
      const elapsed = Math.max(0, Math.floor((serverNow - Number(startedAt)) / 1000));
      state.reading = Math.max(0, duration - elapsed);
      const el = document.getElementById("readTimer");
      if (el) el.textContent = state.reading;
      if (state.reading <= 0) {
        clearInterval(state.timer);
        state.timer = null;
        if (online.isHost) {
          db.ref(`rooms/${online.roomCode}/publicGame`).update({
            phase: "game",
            readingEndedAt: firebase.database.ServerValue.TIMESTAMP
          }).catch(err => {
            console.error("同步進入遊戲階段失敗", err);
            notify("同步開始遊戲失敗，請確認網路後重試");
          });
        } else {
          const el = document.querySelector("#app .muted-note");
          if (el) el.textContent = "圖鑑閱讀時間結束，正在等待房主同步開始遊戲…";
        }
      }
    };
    setScreen("reading");
    update();
    if (state.reading > 0) state.timer = setInterval(update, 200);
  }

  function completeOnlineStart() {
    if (state.screen !== "reading") return;
    clearInterval(state.timer);
    state.timer = null;
    startGameAfterReading();
  }

  function renderOnlineLobby(room) {
    const players = online.players;
    const count = players.length;
    const isHost = online.isHost;
    app.innerHTML = `<div class="eyebrow">ONLINE WAITING ROOM</div>
      <h1 class="page-title">等待玩家加入</h1>
      <p class="sub">這是 Firebase 線上房間。其他玩家可用自己的手機輸入房號加入。</p>
      <div class="panel"><small style="color:var(--muted)">ROOM CODE · 房間代碼</small>
        <div class="code-box">${room.code}</div>
        <button class="btn btn-soft" style="width:100%;margin-top:10px" id="copyRoomCode">複製房間代碼</button>
      </div>
      <div class="section-head"><h2>玩家名單</h2><small>${count} / ${room.maxPlayers} 人</small></div>
      <div class="panel player-list">${players.map(p => `<div class="player-row"><div class="avatar">${esc(p.name).slice(0,1)}</div><div><strong>${esc(p.name)}</strong><small>${p.uid === room.hostUid ? "房間建立者" : "已加入房間"}</small></div>${p.uid === room.hostUid ? '<span class="tag gold">HOST</span>' : '<span class="tag">ONLINE</span>'}</div>`).join("")}
      ${Array.from({length:Math.max(0, Number(room.maxPlayers)-count)}, () => '<div class="player-row" style="opacity:.45"><div class="avatar">＋</div><div><strong>等待玩家加入</strong><small>分享房間代碼邀請朋友</small></div></div>').join("")}</div>
      <div class="muted-note">${SINGLE_PLAYER_TEST_MODE ? "單人測試模式已啟用：目前 1 位玩家即可由房主開始。正式遊戲仍設定為 4～6 人。所有裝置會同步進入 20 秒魚類圖鑑閱讀階段；發牌、抽換卡、猜測及勝利狀態的跨裝置同步仍需下一階段整合。" : "正式模式：至少 4 位玩家加入後，由房主開始遊戲。所有裝置會同步進入 20 秒魚類圖鑑閱讀階段；發牌、抽換卡、猜測及勝利狀態的跨裝置同步仍需下一階段整合。"}</div>
      ${isHost ? `<button class="btn btn-dark" style="width:100%" id="startOnlineGame" ${count < MIN_PLAYERS_TO_START ? "disabled" : ""}>${count < MIN_PLAYERS_TO_START ? `至少需要 ${MIN_PLAYERS_TO_START} 人（目前 ${count} 人）` : "開始遊戲 →"}</button>` : '<div class="muted-note">等待房主開始遊戲。</div>'}
      <button class="btn btn-outline" style="width:100%;margin-top:9px" id="leaveOnlineRoom">離開房間</button>`;
    document.getElementById("copyRoomCode")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(room.code); notify("已複製房間代碼"); }
      catch (_) { notify("房間代碼：" + room.code); }
    });
    document.getElementById("startOnlineGame")?.addEventListener("click", async () => {
      if (!online.isHost) return notify("只有房主可以開始遊戲");
      if (count < MIN_PLAYERS_TO_START) return notify(`至少需要 ${MIN_PLAYERS_TO_START} 位玩家才能開始`);
      const button = document.getElementById("startOnlineGame");
      if (button) { button.disabled = true; button.textContent = "正在開始…"; }
      try {
        const roomRef = db.ref(`rooms/${online.roomCode}`);
        const latest = await roomRef.once("value");
        const currentRoom = latest.val();
        const currentCount = Object.keys(currentRoom?.players || {}).length;
        if (!currentRoom || currentRoom.status !== "lobby") throw new Error("房間狀態已改變，請重新確認");
        if (currentCount < MIN_PLAYERS_TO_START) throw new Error(`玩家人數不足 ${MIN_PLAYERS_TO_START} 人`);
        await roomRef.update({
          status: "playing",
          publicGame: {
            phase: "reading",
            startedAt: firebase.database.ServerValue.TIMESTAMP,
            startedBy: online.uid
          }
        });
      } catch (err) {
        console.error("開始遊戲失敗", err);
        notify("開始遊戲失敗：" + (err.message || err));
        renderOnlineLobby((await db.ref(`rooms/${online.roomCode}`).once("value")).val());
      }
    });
    document.getElementById("leaveOnlineRoom")?.addEventListener("click", leaveRoom);
  }

  async function leaveRoom() {
    await ready;
    if (!online.roomCode) return setScreen("home");
    const code = online.roomCode;
    stopRoomListener();
    await db.ref(`rooms/${code}/players/${online.uid}`).remove().catch(() => {});
    const roomSnap = await db.ref(`rooms/${code}`).once("value").catch(() => null);
    if (roomSnap?.exists()) {
      const room = roomSnap.val();
      if (room.hostUid === online.uid) {
        const remaining = Object.values(room.players || {}).sort((a,b)=>(a.joinedAt||0)-(b.joinedAt||0));
        if (remaining.length) {
          const nextHost = remaining[0];
          await db.ref(`rooms/${code}`).update({ hostUid: nextHost.uid });
          await db.ref(`rooms/${code}/players/${nextHost.uid}/host`).set(true);
        } else {
          await db.ref(`rooms/${code}`).remove();
        }
      }
    }
    online.roomCode = null;
    online.isHost = false;
    state.room = null;
    setScreen("home");
  }

  // 線上房間不可由單一玩家提前跳過倒數；由房主透過 Firebase 統一切換階段。
  window.skipReading = () => {
    if (online.roomCode) return notify("線上遊戲需等待 20 秒倒數結束，才能同步進入遊戲");
    notify("目前不在本機閱讀流程中");
  };

  // Replace local-only room entry points with Firebase-backed actions.
  window.createRoom = () => createOnlineRoom().catch(err => {
    console.error(err); notify("建立房間失敗：" + (err.message || err));
  });
  window.joinRoom = () => {
    modal(`<h2>加入線上遊戲房間</h2><p>輸入房主提供的 6 位數房間代碼。</p>
      <label class="field"><span>你的暱稱</span><input id="joinName" maxlength="10" placeholder="輸入玩家暱稱"></label>
      <label class="field"><span>房間代碼</span><input id="joinCode" maxlength="6" placeholder="例如 A2B8C9" style="text-transform:uppercase"></label>
      <button class="btn btn-dark" style="width:100%" id="confirmJoin">確認加入</button>`);
    document.getElementById("confirmJoin").addEventListener("click", () => joinOnlineRoom().catch(err => {
      console.error(err); notify("加入房間失敗：" + (err.message || err));
    }));
  };
  window.leaveOnlineRoom = leaveRoom;
  window.addEventListener("beforeunload", () => stopRoomListener());
})();
