import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// Inject CSS stylesheet
(function initCSS() {
  const linkId = "comfyui-gallery-css";
  if (!document.getElementById(linkId)) {
    const link = document.createElement("link");
    link.id = linkId;
    link.rel = "stylesheet";
    link.href = new URL("./gallery.css", import.meta.url).href;
    document.head.appendChild(link);
  }
})();

class GalleryManager {
  constructor() {
    this.isOpen = false;
    this.folders = [];
    this.currentFolder = "";
    this.currentPage = 1;
    this.limit = 60;
    this.sort = "newest";
    this.search = "";
    this.items = [];
    this.totalItems = 0;
    this.totalPages = 1;
    this.selectedImage = null;
    this.selectedIndex = -1;
    this.selectedMetadata = null;

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    // 1. Floating Action Button (FAB)
    this.fab = document.createElement("div");
    this.fab.className = "cg-fab";
    this.fab.innerHTML = `🖼️<div class="cg-fab-tooltip">Open Gallery (Alt+G, Drag to move)</div>`;

    // Restore saved position
    try {
      const savedPos = localStorage.getItem("cg-fab-position");
      if (savedPos) {
        const { left, top } = JSON.parse(savedPos);
        const maxLeft = Math.max(0, window.innerWidth - 60);
        const maxTop = Math.max(0, window.innerHeight - 60);
        const clampedLeft = Math.min(Math.max(10, left), maxLeft);
        const clampedTop = Math.min(Math.max(10, top), maxTop);
        this.fab.style.left = `${clampedLeft}px`;
        this.fab.style.top = `${clampedTop}px`;
        this.fab.style.right = "auto";
        this.fab.style.bottom = "auto";
      }
    } catch {}

    this.setupDraggableFAB();
    document.body.appendChild(this.fab);

    // 2. Modal Overlay & Window
    this.overlay = document.createElement("div");
    this.overlay.className = "cg-modal-overlay";
    this.overlay.innerHTML = `
      <div class="cg-window">
        <!-- Header -->
        <div class="cg-header">
          <div class="cg-header-left">
            <div class="cg-logo">
              <div class="cg-logo-icon">🖼️</div>
              <span>ComfyUI Gallery</span>
            </div>
          </div>
          <div class="cg-header-center">
            <div class="cg-search-box">
              <span class="cg-search-icon">🔍</span>
              <input type="text" class="cg-search-input" placeholder="Search filenames in current folder..." />
            </div>
            <select class="cg-select cg-sort-select">
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              <option value="size_desc">File Size</option>
            </select>
          </div>
          <div class="cg-header-right">
            <button class="cg-icon-btn cg-refresh-btn" title="Refresh Gallery">🔄</button>
            <button class="cg-icon-btn cg-close-btn" title="Close (Esc)">✕</button>
          </div>
        </div>

        <!-- Body -->
        <div class="cg-body">
          <!-- Sidebar -->
          <div class="cg-sidebar">
            <div class="cg-sidebar-header">Folders</div>
            <div class="cg-folder-list"></div>
          </div>

          <!-- Main Content -->
          <div class="cg-content">
            <div class="cg-toolbar">
              <div class="cg-current-folder">
                <span>📁</span>
                <span class="cg-folder-name-label">Root (output)</span>
              </div>
              <div class="cg-toolbar-stats" style="font-size: 13px; color: var(--cg-text-muted);">
                <span class="cg-total-label">0 items</span>
              </div>
            </div>

            <div class="cg-grid-wrapper">
              <div class="cg-grid"></div>
            </div>

            <!-- Pagination Bar -->
            <div class="cg-pagination">
              <button class="cg-page-btn cg-prev-btn">◀ Previous</button>
              <span class="cg-page-indicator" style="font-size: 13px; color: var(--cg-text-muted);">Page 1 of 1</span>
              <button class="cg-page-btn cg-next-btn">Next ▶</button>
            </div>
          </div>
        </div>

        <!-- Inspector Drawer / Modal -->
        <div class="cg-inspector-overlay">
          <div class="cg-inspector-view">
            <button class="cg-nav-btn cg-nav-prev">◀</button>
            <img class="cg-inspector-img" src="" alt="" />
            <button class="cg-nav-btn cg-nav-next">▶</button>
          </div>
          <div class="cg-inspector-sidebar">
            <div class="cg-inspector-header">
              <div class="cg-inspector-title">Image Details</div>
              <button class="cg-icon-btn cg-inspector-close">✕</button>
            </div>
            <div class="cg-inspector-content">
              <!-- Action Buttons -->
              <div class="cg-action-bar">
                <button class="cg-btn-primary cg-load-workflow-btn">🚀 Load Workflow to Canvas</button>
                <button class="cg-btn-sec cg-copy-pos-btn">📋 Copy Prompt</button>
                <button class="cg-btn-sec cg-copy-seed-btn">🌱 Copy Seed</button>
                <button class="cg-btn-sec cg-download-btn">⬇️ Download</button>
                <button class="cg-btn-sec cg-btn-danger cg-delete-btn">🗑️ Delete</button>
              </div>

              <!-- Generation Params -->
              <div class="cg-params-grid">
                <div class="cg-param-pill"><span class="cg-pill-name">Model</span><span class="cg-pill-val cg-val-model">-</span></div>
                <div class="cg-param-pill"><span class="cg-pill-name">Seed</span><span class="cg-pill-val cg-val-seed">-</span></div>
                <div class="cg-param-pill"><span class="cg-pill-name">Steps / CFG</span><span class="cg-pill-val cg-val-steps-cfg">-</span></div>
                <div class="cg-param-pill"><span class="cg-pill-name">Sampler</span><span class="cg-pill-val cg-val-sampler">-</span></div>
              </div>

              <!-- Positive Prompt -->
              <div class="cg-param-box">
                <div class="cg-param-label">Positive Prompt</div>
                <div class="cg-param-text cg-val-pos">No positive prompt detected.</div>
              </div>

              <!-- Negative Prompt -->
              <div class="cg-param-box cg-neg-box" style="display: none;">
                <div class="cg-param-label">Negative Prompt</div>
                <div class="cg-param-text cg-val-neg"></div>
              </div>

              <!-- File Info -->
              <div class="cg-param-box">
                <div class="cg-param-label">File Details</div>
                <div class="cg-param-text cg-val-fileinfo" style="font-size: 11px; color: var(--cg-text-muted);"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.overlay);

    // Cache elements
    this.folderListEl = this.overlay.querySelector(".cg-folder-list");
    this.gridEl = this.overlay.querySelector(".cg-grid");
    this.folderNameLabel = this.overlay.querySelector(".cg-folder-name-label");
    this.totalLabel = this.overlay.querySelector(".cg-total-label");
    this.pageIndicator = this.overlay.querySelector(".cg-page-indicator");
    this.prevBtn = this.overlay.querySelector(".cg-prev-btn");
    this.nextBtn = this.overlay.querySelector(".cg-next-btn");
    this.searchInput = this.overlay.querySelector(".cg-search-input");
    this.sortSelect = this.overlay.querySelector(".cg-sort-select");

    // Inspector elements
    this.inspectorOverlay = this.overlay.querySelector(".cg-inspector-overlay");
    this.inspectorImg = this.overlay.querySelector(".cg-inspector-img");
    this.inspectorTitle = this.overlay.querySelector(".cg-inspector-title");
    this.valModel = this.overlay.querySelector(".cg-val-model");
    this.valSeed = this.overlay.querySelector(".cg-val-seed");
    this.valStepsCfg = this.overlay.querySelector(".cg-val-steps-cfg");
    this.valSampler = this.overlay.querySelector(".cg-val-sampler");
    this.valPos = this.overlay.querySelector(".cg-val-pos");
    this.valNeg = this.overlay.querySelector(".cg-val-neg");
    this.negBox = this.overlay.querySelector(".cg-neg-box");
    this.valFileinfo = this.overlay.querySelector(".cg-val-fileinfo");
    this.loadWorkflowBtn = this.overlay.querySelector(".cg-load-workflow-btn");
  }

  setupDraggableFAB() {
    let isDragging = false;
    let dragStarted = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
      // Only primary mouse button or touch
      if (e.button && e.button !== 0) return;
      isDragging = false;
      dragStarted = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = this.fab.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (e) => {
      if (!dragStarted) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Threshold of 4px to distinguish between click and drag
      if (!isDragging && Math.hypot(dx, dy) > 4) {
        isDragging = true;
        this.fab.classList.add("cg-dragging");
      }

      if (isDragging) {
        e.preventDefault();
        const maxLeft = Math.max(0, window.innerWidth - this.fab.offsetWidth - 10);
        const maxTop = Math.max(0, window.innerHeight - this.fab.offsetHeight - 10);
        const newLeft = Math.min(Math.max(10, initialLeft + dx), maxLeft);
        const newTop = Math.min(Math.max(10, initialTop + dy), maxTop);

        this.fab.style.left = `${newLeft}px`;
        this.fab.style.top = `${newTop}px`;
        this.fab.style.right = "auto";
        this.fab.style.bottom = "auto";
      }
    };

    const onPointerUp = () => {
      dragStarted = false;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      if (isDragging) {
        this.fab.classList.remove("cg-dragging");
        const rect = this.fab.getBoundingClientRect();
        try {
          localStorage.setItem("cg-fab-position", JSON.stringify({ left: rect.left, top: rect.top }));
        } catch {}
        setTimeout(() => {
          isDragging = false;
        }, 50);
      } else {
        this.toggle();
      }
    };

    this.fab.addEventListener("pointerdown", onPointerDown);
  }

  bindEvents() {
    // Close button
    this.overlay.querySelector(".cg-close-btn").onclick = () => this.close();
    this.overlay.onclick = (e) => {
      if (e.target === this.overlay) this.close();
    };

    // Refresh
    this.overlay.querySelector(".cg-refresh-btn").onclick = () => this.refresh();

    // Search with debounce
    let searchTimer = null;
    this.searchInput.oninput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        this.search = this.searchInput.value.trim();
        this.currentPage = 1;
        this.loadImages();
      }, 300);
    };

    // Sort change
    this.sortSelect.onchange = () => {
      this.sort = this.sortSelect.value;
      this.currentPage = 1;
      this.loadImages();
    };

    // Pagination
    this.prevBtn.onclick = () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.loadImages();
      }
    };
    this.nextBtn.onclick = () => {
      if (this.currentPage < this.totalPages) {
        this.currentPage++;
        this.loadImages();
      }
    };

    // Inspector
    this.overlay.querySelector(".cg-inspector-close").onclick = () => this.closeInspector();
    this.overlay.querySelector(".cg-nav-prev").onclick = () => this.navigateInspector(-1);
    this.overlay.querySelector(".cg-nav-next").onclick = () => this.navigateInspector(1);

    // Inspector Action Buttons
    this.loadWorkflowBtn.onclick = () => this.loadWorkflowToCanvas();
    this.overlay.querySelector(".cg-copy-pos-btn").onclick = () => {
      if (this.selectedMetadata?.summary?.positive) {
        navigator.clipboard.writeText(this.selectedMetadata.summary.positive);
        this.showToast("Positive prompt copied to clipboard!");
      }
    };
    this.overlay.querySelector(".cg-copy-seed-btn").onclick = () => {
      if (this.selectedMetadata?.summary?.seed) {
        navigator.clipboard.writeText(this.selectedMetadata.summary.seed);
        this.showToast("Seed copied to clipboard!");
      }
    };
    this.overlay.querySelector(".cg-download-btn").onclick = () => {
      if (this.selectedImage) {
        const a = document.createElement("a");
        a.href = this.selectedImage.url;
        a.download = this.selectedImage.name;
        a.click();
      }
    };
    this.overlay.querySelector(".cg-delete-btn").onclick = () => this.deleteCurrentImage();

    // Global Keydown
    window.addEventListener("keydown", (e) => {
      if (e.altKey && (e.key === "g" || e.key === "G" || e.code === "KeyG")) {
        e.preventDefault();
        this.toggle();
        return;
      }
      if (this.isOpen) {
        if (e.key === "Escape") {
          if (this.inspectorOverlay.classList.contains("active")) {
            this.closeInspector();
          } else {
            this.close();
          }
        } else if (this.inspectorOverlay.classList.contains("active")) {
          if (e.key === "ArrowLeft") this.navigateInspector(-1);
          if (e.key === "ArrowRight") this.navigateInspector(1);
        }
      }
    });
  }

  showToast(message) {
    const toast = document.createElement("div");
    toast.style.cssText = `
      position: fixed;
      bottom: 40px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(16, 185, 129, 0.95);
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.5);
      z-index: 100000;
      animation: cg-scale-up 0.2s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  async open() {
    this.isOpen = true;
    this.overlay.classList.add("active");
    await this.loadFolders();
    await this.loadImages();
  }

  close() {
    this.isOpen = false;
    this.overlay.classList.remove("active");
    this.closeInspector();
  }

  async refresh() {
    await this.loadFolders();
    await this.loadImages();
  }

  async loadFolders() {
    try {
      const res = await fetch("/Gallery/folders");
      const data = await res.json();
      this.folders = data.folders || [];
      this.renderFolders();
    } catch (e) {
      console.error("[ComfyUI-Gallery] Failed to load folders:", e);
    }
  }

  renderFolders() {
    this.folderListEl.innerHTML = "";
    this.folders.forEach((f) => {
      const item = document.createElement("div");
      item.className = `cg-folder-item ${f.id === this.currentFolder ? "active" : ""}`;
      item.innerHTML = `
        <div class="cg-folder-item-title">
          <span>${f.id === "" ? "🏠" : "📁"}</span>
          <span>${f.id === "" ? "Root (output)" : f.name}</span>
        </div>
        <span class="cg-folder-badge">${f.count}</span>
      `;
      item.onclick = () => {
        this.currentFolder = f.id;
        this.currentPage = 1;
        this.renderFolders();
        this.loadImages();
      };
      this.folderListEl.appendChild(item);
    });
  }

  async loadImages() {
    this.folderNameLabel.textContent = this.currentFolder ? this.currentFolder : "Root (output)";
    this.gridEl.innerHTML = `<div class="cg-loading"><div class="cg-spinner"></div><span>Loading gallery...</span></div>`;

    try {
      const params = new URLSearchParams({
        folder: this.currentFolder,
        page: this.currentPage,
        limit: this.limit,
        sort: this.sort,
        search: this.search,
      });

      const res = await fetch(`/Gallery/images?${params.toString()}`);
      const data = await res.json();

      this.items = data.items || [];
      this.totalItems = data.total || 0;
      this.totalPages = data.total_pages || 1;
      this.currentPage = data.page || 1;

      this.totalLabel.textContent = `${this.totalItems} items`;
      this.pageIndicator.textContent = `Page ${this.currentPage} of ${this.totalPages}`;
      this.prevBtn.disabled = this.currentPage <= 1;
      this.nextBtn.disabled = this.currentPage >= this.totalPages;

      this.renderGrid();
    } catch (e) {
      console.error("[ComfyUI-Gallery] Failed to load images:", e);
      this.gridEl.innerHTML = `<div class="cg-loading"><span>Error loading images</span></div>`;
    }
  }

  renderGrid() {
    this.gridEl.innerHTML = "";
    if (this.items.length === 0) {
      this.gridEl.innerHTML = `
        <div class="cg-loading" style="grid-column: 1 / -1;">
          <span style="font-size: 32px;">🖼️</span>
          <span>No images found in this folder</span>
        </div>
      `;
      return;
    }

    this.items.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "cg-card";
      card.innerHTML = `
        <div class="cg-card-img-wrap">
          <img class="cg-card-img" src="${item.thumbnail_url}" loading="lazy" alt="${item.name}" />
        </div>
        <div class="cg-card-info">
          <div class="cg-card-name" title="${item.name}">${item.name}</div>
          <div class="cg-card-meta">
            <span>${item.date ? item.date.split(" ")[0] : ""}</span>
            <span>${item.size}</span>
          </div>
        </div>
      `;
      card.onclick = () => this.openInspector(item, index);
      this.gridEl.appendChild(card);
    });
  }

  async openInspector(item, index) {
    this.selectedImage = item;
    this.selectedIndex = index;
    this.selectedMetadata = null;

    this.inspectorImg.src = item.url;
    this.inspectorTitle.textContent = item.name;
    this.inspectorOverlay.classList.add("active");

    // Reset fields
    this.valModel.textContent = "Loading...";
    this.valSeed.textContent = "Loading...";
    this.valStepsCfg.textContent = "Loading...";
    this.valSampler.textContent = "Loading...";
    this.valPos.textContent = "Extracting prompt metadata...";
    this.negBox.style.display = "none";
    this.valFileinfo.textContent = `${item.size} | ${item.date}`;

    // On-demand fetch metadata
    try {
      const params = new URLSearchParams({
        folder: item.subfolder || "",
        filename: item.name,
      });
      const res = await fetch(`/Gallery/image/metadata?${params.toString()}`);
      const data = await res.json();
      this.selectedMetadata = data;

      const summary = data.summary || {};
      const fileinfo = data.fileinfo || {};

      this.valModel.textContent = summary.model || "Unknown";
      this.valModel.title = summary.model || "";
      this.valSeed.textContent = summary.seed || "N/A";
      this.valStepsCfg.textContent = `${summary.steps || "-"} / ${summary.cfg || "-"}`;
      this.valSampler.textContent = `${summary.sampler || "-"} ${summary.scheduler ? "(" + summary.scheduler + ")" : ""}`;

      this.valPos.textContent = summary.positive || "No positive prompt metadata found in image.";
      if (summary.negative) {
        this.negBox.style.display = "flex";
        this.valNeg.textContent = summary.negative;
      } else {
        this.negBox.style.display = "none";
      }

      this.valFileinfo.innerHTML = `
        <div>Resolution: ${fileinfo.resolution || "Unknown"}</div>
        <div>Size: ${fileinfo.size || item.size}</div>
        <div>Date: ${fileinfo.date || item.date}</div>
        <div style="margin-top: 4px; word-break: break-all; opacity: 0.7;">${fileinfo.path || ""}</div>
      `;
    } catch (e) {
      console.error("[ComfyUI-Gallery] Failed to fetch metadata:", e);
      this.valPos.textContent = "Failed to load metadata.";
    }
  }

  closeInspector() {
    this.inspectorOverlay.classList.remove("active");
    this.selectedImage = null;
    this.selectedMetadata = null;
    this.selectedIndex = -1;
  }

  navigateInspector(direction) {
    if (!this.items.length) return;
    let newIndex = this.selectedIndex + direction;
    if (newIndex < 0) newIndex = this.items.length - 1;
    if (newIndex >= this.items.length) newIndex = 0;
    this.openInspector(this.items[newIndex], newIndex);
  }

  async loadWorkflowToCanvas() {
    if (!this.selectedMetadata || !this.selectedMetadata.workflow) {
      this.showToast("No workflow data available in this image.");
      return;
    }
    try {
      const workflow = this.selectedMetadata.workflow;
      if (app && app.loadGraphData) {
        await app.loadGraphData(workflow);
        this.showToast("🚀 Workflow successfully loaded to canvas!");
      } else {
        this.showToast("ComfyUI app graph loader not available.");
      }
    } catch (e) {
      console.error("[ComfyUI-Gallery] Error loading workflow:", e);
      this.showToast("Failed to load workflow into canvas: " + e.message);
    }
  }

  async deleteCurrentImage() {
    if (!this.selectedImage) return;
    const confirmDelete = confirm(`Are you sure you want to delete "${this.selectedImage.name}"?`);
    if (!confirmDelete) return;

    try {
      const res = await fetch("/Gallery/image/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder: this.selectedImage.subfolder || "",
          filename: this.selectedImage.name,
        }),
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Deleted ${this.selectedImage.name}`);
        this.closeInspector();
        await this.loadImages();
        await this.loadFolders();
      } else {
        alert("Failed to delete image: " + (data.error || "Unknown error"));
      }
    } catch (e) {
      alert("Error deleting image: " + e.message);
    }
  }
}

// Register ComfyUI Extension
app.registerExtension({
  name: "ComfyUI.Gallery",
  async setup() {
    const gallery = new GalleryManager();

    // Inject Menu Button into ComfyUI Top Bar / Menu / Action group
    const tryInjectMenuButton = () => {
      if (document.getElementById("cg-topbar-button")) return true;
      const candidates = [
        app.menu?.settingsGroup?.element,
        app.menu?.actionsGroup?.element,
        document.querySelector(".comfy-menu"),
        document.querySelector(".comfyui-menu"),
        document.querySelector("#comfy-topbar"),
        document.querySelector(".comfy-top-menu-bar"),
        document.querySelector("div.workflow-tabs-container")
      ];
      for (const parent of candidates) {
        if (parent) {
          const btn = document.createElement("button");
          btn.id = "cg-topbar-button";
          btn.className = "cg-menu-btn";
          btn.innerHTML = `🖼️ Gallery`;
          btn.onclick = () => gallery.toggle();
          parent.appendChild(btn);
          return true;
        }
      }
      return false;
    };

    if (!tryInjectMenuButton()) {
      const interval = setInterval(() => {
        if (tryInjectMenuButton()) {
          clearInterval(interval);
        }
      }, 1000);
      setTimeout(() => clearInterval(interval), 10000);
    }

    console.log("[ComfyUI-Gallery] Modern Gallery extension initialized successfully (Alt+G / 🖼️ button to open).");
  },
});
