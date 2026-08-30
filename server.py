import os
import sys
import json
import shutil
import asyncio
from pathlib import Path
from aiohttp import web
from server import PromptServer
import folder_paths

from .folder_scanner import get_folder_tree, scan_folder_page
from .metadata_extractor import extract_image_metadata

def gallery_log(msg):
    print(f"[ComfyUI-Gallery] {msg}")

def get_base_output_dir():
    return folder_paths.get_output_directory()

@PromptServer.instance.routes.get("/Gallery/folders")
async def api_get_folders(request):
    """Returns list of subfolders under output directory with media counts."""
    base_dir = get_base_output_dir()
    loop = asyncio.get_running_loop()
    try:
        folders = await loop.run_in_executor(None, get_folder_tree, base_dir)
        return web.json_response({"folders": folders})
    except Exception as e:
        gallery_log(f"Error fetching folders: {e}")
        return web.json_response({"folders": [], "error": str(e)}, status=500)

@PromptServer.instance.routes.get("/Gallery/images")
async def api_get_images(request):
    """Returns paginated image list for a specific folder."""
    base_dir = get_base_output_dir()
    query = request.rel_url.query
    
    subfolder = query.get("folder", "")
    if subfolder in ("null", "undefined", "./", "."):
        subfolder = ""
        
    try:
        page = int(query.get("page", 1))
    except ValueError:
        page = 1

    try:
        limit = int(query.get("limit", 60))
    except ValueError:
        limit = 60

    sort = query.get("sort", "newest")
    search = query.get("search", "")

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(
            None, 
            scan_folder_page, 
            base_dir, 
            subfolder, 
            page, 
            limit, 
            sort, 
            search
        )
        return web.json_response(result)
    except Exception as e:
        gallery_log(f"Error scanning folder images: {e}")
        return web.json_response({
            "items": [],
            "total": 0,
            "page": 1,
            "limit": limit,
            "total_pages": 0,
            "folder": subfolder,
            "error": str(e)
        }, status=500)

@PromptServer.instance.routes.get("/Gallery/image/metadata")
async def api_get_image_metadata(request):
    """Extracts on-demand prompt/workflow metadata for a single image file."""
    base_dir = get_base_output_dir()
    query = request.rel_url.query
    
    subfolder = query.get("folder", "").strip("/\\")
    if subfolder in ("null", "undefined", "./", "."):
        subfolder = ""
        
    filename = query.get("filename", "")
    if not filename:
        return web.json_response({"error": "filename parameter is required"}, status=400)

    target_path = os.path.normpath(os.path.join(base_dir, subfolder, filename)) if subfolder else os.path.normpath(os.path.join(base_dir, filename))

    # Security check: ensure target_path is inside base_dir
    real_base = os.path.realpath(base_dir)
    real_target = os.path.realpath(target_path)
    if not real_target.startswith(real_base):
        return web.json_response({"error": "Access denied"}, status=403)

    loop = asyncio.get_running_loop()
    try:
        metadata = await loop.run_in_executor(None, extract_image_metadata, real_target)
        return web.json_response(metadata)
    except Exception as e:
        gallery_log(f"Error extracting metadata for {filename}: {e}")
        return web.json_response({"error": str(e)}, status=500)

@PromptServer.instance.routes.post("/Gallery/image/delete")
async def api_delete_image(request):
    """Deletes an image file safely."""
    base_dir = get_base_output_dir()
    try:
        data = await request.json()
        subfolder = data.get("folder", "").strip("/\\")
        filename = data.get("filename", "")
        if not filename:
            return web.json_response({"error": "filename is required"}, status=400)

        target_path = os.path.normpath(os.path.join(base_dir, subfolder, filename)) if subfolder else os.path.normpath(os.path.join(base_dir, filename))

        real_base = os.path.realpath(base_dir)
        real_target = os.path.realpath(target_path)
        if not real_target.startswith(real_base) or not os.path.isfile(real_target):
            return web.json_response({"error": "File not found or access denied"}, status=404)

        try:
            # Try send2trash if available, else os.remove
            from send2trash import send2trash
            send2trash(real_target)
        except Exception:
            os.remove(real_target)

        gallery_log(f"Deleted file: {filename}")
        return web.json_response({"success": True, "filename": filename})
    except Exception as e:
        gallery_log(f"Error deleting file: {e}")
        return web.json_response({"error": str(e)}, status=500)

@PromptServer.instance.routes.post("/Gallery/image/move")
async def api_move_image(request):
    """Moves an image from one folder to another."""
    base_dir = get_base_output_dir()
    try:
        data = await request.json()
        from_folder = data.get("from_folder", "").strip("/\\")
        to_folder = data.get("to_folder", "").strip("/\\")
        filename = data.get("filename", "")
        if not filename:
            return web.json_response({"error": "filename is required"}, status=400)

        src_path = os.path.normpath(os.path.join(base_dir, from_folder, filename)) if from_folder else os.path.normpath(os.path.join(base_dir, filename))
        dest_dir = os.path.normpath(os.path.join(base_dir, to_folder)) if to_folder else base_dir
        dest_path = os.path.join(dest_dir, filename)

        real_base = os.path.realpath(base_dir)
        if not os.path.realpath(src_path).startswith(real_base) or not os.path.realpath(dest_dir).startswith(real_base):
            return web.json_response({"error": "Access denied"}, status=403)

        os.makedirs(dest_dir, exist_ok=True)
        shutil.move(src_path, dest_path)
        gallery_log(f"Moved file {filename} to {to_folder}")
        return web.json_response({"success": True, "filename": filename, "to_folder": to_folder})
    except Exception as e:
        gallery_log(f"Error moving file: {e}")
        return web.json_response({"error": str(e)}, status=500)