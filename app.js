const OWNER_PIN = "1101";
const STORAGE_KEY = "bandimals-audio-tracks";
const DB_NAME = "bandimals-audio";
const DB_VERSION = 1;
const STORE_NAME = "files";

let tracks = [];
let dbPromise;
let activeObjectUrls = [];

const trackList = document.querySelector("#track-list");
const ownerTrackList = document.querySelector("#owner-track-list");
const emptyState = document.querySelector("#empty-state");
const trackCount = document.querySelector("#track-count");
const ownerPanel = document.querySelector("#owner-panel");
const ownerToggle = document.querySelector("#owner-toggle");
const closePanel = document.querySelector("#close-panel");
const pinForm = document.querySelector("#pin-form");
const ownerContent = document.querySelector("#owner-content");
const audioForm = document.querySelector("#audio-form");
const toast = document.querySelector("#toast");
const clearLocal = document.querySelector("#clear-local");

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function saveBlob(id, file) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(file, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function getBlob(id) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deleteBlob(id) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function loadTracks() {
  try {
    tracks = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    tracks = [];
  }
}

function persistTracks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tracks));
}

function escapeText(value) {
  const node = document.createElement("span");
  node.textContent = value || "";
  return node.innerHTML;
}

function formatDate(value) {
  if (!value) return "";

  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function setPanelOpen(open) {
  ownerPanel.classList.toggle("open", open);
  ownerPanel.setAttribute("aria-hidden", String(!open));
}

function releaseObjectUrls() {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = [];
}

async function getTrackSource(track) {
  if (track.kind === "upload") {
    const blob = await getBlob(track.id);
    if (!blob) return "";
    const objectUrl = URL.createObjectURL(blob);
    activeObjectUrls.push(objectUrl);
    return objectUrl;
  }

  return track.url;
}

async function renderTracks() {
  releaseObjectUrls();

  trackCount.textContent = `${tracks.length} ${tracks.length === 1 ? "file" : "files"}`;
  emptyState.hidden = tracks.length > 0;

  const cards = await Promise.all(
    tracks.map(async (track) => {
      const src = await getTrackSource(track);
      const metaParts = [formatDate(track.date)].filter(Boolean);

      return `
        <article class="track-card">
          <div class="track-top">
            <div>
              <h3>${escapeText(track.title)}</h3>
              <div class="track-meta">
                ${metaParts.map((part) => `<span>${escapeText(part)}</span>`).join("")}
              </div>
            </div>
          </div>
          ${
            src
              ? `<audio controls preload="metadata" src="${escapeText(src)}"></audio>`
              : `<p class="form-note">This uploaded file is no longer available in this browser.</p>`
          }
        </article>
      `;
    }),
  );

  trackList.innerHTML = cards.join("");
  renderOwnerTracks();
}

function renderOwnerTracks() {
  if (!tracks.length) {
    ownerTrackList.innerHTML = `<p class="form-note">No files yet.</p>`;
    return;
  }

  ownerTrackList.innerHTML = tracks
    .map(
      (track) => `
        <div class="owner-item">
          <div>
            <strong>${escapeText(track.title)}</strong>
            <span>${track.kind === "upload" ? "Uploaded file" : "Audio link"}</span>
          </div>
          <button class="remove-button" type="button" data-remove="${escapeText(track.id)}">Remove</button>
        </div>
      `,
    )
    .join("");
}

function resetForm() {
  audioForm.reset();
  document.querySelector("#track-date").valueAsDate = new Date();
}

ownerToggle.addEventListener("click", () => setPanelOpen(true));
closePanel.addEventListener("click", () => setPanelOpen(false));

ownerPanel.addEventListener("click", (event) => {
  if (event.target === ownerPanel) setPanelOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setPanelOpen(false);
});

pinForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const submittedPin = new FormData(pinForm).get("pin");
  if (submittedPin !== OWNER_PIN) {
    showToast("That PIN did not unlock the owner tools.");
    return;
  }

  pinForm.hidden = true;
  ownerContent.hidden = false;
  resetForm();
  showToast("Owner tools unlocked.");
});

audioForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(audioForm);
  const title = String(formData.get("title") || "").trim();
  const date = String(formData.get("date") || "");
  const url = String(formData.get("url") || "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;

  if (!url && !hasFile) {
    showToast("Add an audio link or upload an audio file.");
    return;
  }

  const id = crypto.randomUUID();
  const track = {
    id,
    title,
    date,
    kind: hasFile ? "upload" : "url",
    url: hasFile ? "" : url,
  };

  if (hasFile) {
    await saveBlob(id, file);
  }

  tracks = [track, ...tracks];
  persistTracks();
  resetForm();
  await renderTracks();
  showToast("Audio added.");
});

ownerTrackList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;

  const id = button.getAttribute("data-remove");
  const track = tracks.find((item) => item.id === id);
  tracks = tracks.filter((item) => item.id !== id);
  persistTracks();

  if (track?.kind === "upload") {
    await deleteBlob(id);
  }

  await renderTracks();
  showToast("Audio removed.");
});

clearLocal.addEventListener("click", async () => {
  const uploadedIds = tracks.filter((track) => track.kind === "upload").map((track) => track.id);
  await Promise.all(uploadedIds.map(deleteBlob));
  tracks = [];
  persistTracks();
  await renderTracks();
  showToast("All audio removed.");
});

loadTracks();
resetForm();
renderTracks();
