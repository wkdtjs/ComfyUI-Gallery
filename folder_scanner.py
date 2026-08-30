import os
import urllib.parse
from datetime import datetime
from pathlib import Path
from .metadata_extractor import format_file_size

DEFAULT_EXTENSIONS = (
    '.png', '.jpg', '.jpeg', '.webp', '.gif',  # Images
    '.mp4', '.webm', '.mov',                    # Media / Video
    '.wav', '.mp3', '.m4a', '.flac',            # Audio
    '.obj', '.glb', '.gltf', '.fbx', '.stl'      # 3D
)

_EXT_TYPE_MAP = {
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
    '.mp4': 'video', '.webm': 'video', '.mov': 'video',
    '.wav': 'audio', '.mp3': 'audio', '.m4a': 'audio', '.flac': 'audio',
    '.obj': '3d', '.glb': '3d', '.gltf': '3d', '.fbx': '3d', '.stl': '3d'
}

def get_folder_tree(base_dir):
    """Scans and returns the folder hierarchy under base_dir with file counts."""
    if not os.path.exists(base_dir):
        return []

    folder_list = []
    real_base = os.path.realpath(base_dir)
    visited_paths = set()

    # Count files in a single folder without recursing
    def count_media_in_dir(path):
        count = 0
        try:
            with os.scandir(path) as it:
                for entry in it:
                    try:
                        if entry.is_file(follow_symlinks=True):
                            ext = os.path.splitext(entry.name.lower())[1]
                            if ext in DEFAULT_EXTENSIONS:
                                count += 1
                    except (OSError, PermissionError):
                        pass
        except Exception:
            pass
        return count

    # Root folder
    root_count = count_media_in_dir(base_dir)
    folder_list.append({
        "id": "",
        "name": "Root (output)",
        "path": "",
        "count": root_count
    })
    visited_paths.add(real_base)

    def scan_subfolders(current_path, current_rel=""):
        try:
            with os.scandir(current_path) as it:
                dirs = []
                for entry in it:
                    try:
                        if entry.is_dir(follow_symlinks=True) and not entry.name.startswith("."):
                            real_entry = os.path.realpath(entry.path)
                            if real_entry not in visited_paths:
                                visited_paths.add(real_entry)
                                dirs.append((entry.name, entry.path))
                    except (OSError, PermissionError):
                        continue

                dirs.sort(key=lambda x: x[0].lower())
                for dir_name, dir_path in dirs:
                    sub_rel = os.path.join(current_rel, dir_name).replace("\\", "/")
                    cnt = count_media_in_dir(dir_path)
                    folder_list.append({
                        "id": sub_rel,
                        "name": sub_rel,
                        "path": sub_rel,
                        "count": cnt
                    })
                    # Recurse up to reasonable depth
                    if len(sub_rel.split("/")) < 8:
                        scan_subfolders(dir_path, sub_rel)
        except Exception as e:
            pass

    scan_subfolders(base_dir, "")
    return folder_list

def scan_folder_page(base_dir, subfolder="", page=1, limit=60, sort="newest", search=""):
    """Scans ONLY the specified folder and returns paginated items with full metadata details."""
    subfolder = subfolder.strip("/\\")
    target_dir = os.path.normpath(os.path.join(base_dir, subfolder)) if subfolder else base_dir

    if not os.path.exists(target_dir):
        return {
            "items": [],
            "total": 0,
            "page": page,
            "limit": limit,
            "total_pages": 0,
            "folder": subfolder
        }

    raw_items = []
    search_lower = search.lower().strip() if search else ""

    try:
        with os.scandir(target_dir) as it:
            for entry in it:
                try:
                    if entry.is_file(follow_symlinks=True):
                        ext = os.path.splitext(entry.name.lower())[1]
                        if ext in DEFAULT_EXTENSIONS:
                            if search_lower and search_lower not in entry.name.lower():
                                continue
                            stat = entry.stat(follow_symlinks=True)
                            raw_items.append((entry.name, stat.st_mtime, stat.st_size, ext))
                except (OSError, PermissionError):
                    continue
    except Exception as e:
        print(f"Gallery Error scanning folder {target_dir}: {e}")

    total_count = len(raw_items)

    # Sorting
    if sort == "newest":
        raw_items.sort(key=lambda x: x[1], reverse=True)
    elif sort == "oldest":
        raw_items.sort(key=lambda x: x[1])
    elif sort == "name_asc":
        raw_items.sort(key=lambda x: x[0].lower())
    elif sort == "name_desc":
        raw_items.sort(key=lambda x: x[0].lower(), reverse=True)
    elif sort == "size_desc":
        raw_items.sort(key=lambda x: x[2], reverse=True)

    # Pagination
    limit = max(1, min(limit, 200))
    total_pages = max(1, (total_count + limit - 1) // limit)
    page = max(1, min(page, total_pages))
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    page_slice = raw_items[start_idx:end_idx]

    # Format items for frontend
    items = []
    for name, mtime, size, ext in page_slice:
        encoded_name = urllib.parse.quote(name)
        encoded_sub = urllib.parse.quote(subfolder) if subfolder else ""
        
        # Standard ComfyUI view route: /view?filename=...&subfolder=...&type=output
        view_url = f"/view?filename={encoded_name}&type=output"
        if encoded_sub:
            view_url += f"&subfolder={encoded_sub}"

        items.append({
            "name": name,
            "filename": name,
            "subfolder": subfolder,
            "url": view_url,
            "thumbnail_url": view_url,
            "timestamp": mtime,
            "date": datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M:%S"),
            "size": format_file_size(size),
            "size_bytes": size,
            "type": _EXT_TYPE_MAP.get(ext, "image")
        })

    return {
        "items": items,
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
        "folder": subfolder
    }