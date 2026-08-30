import os
import json
from datetime import datetime
from pathlib import Path
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS, IFD
from PIL.PngImagePlugin import PngImageFile
from PIL.JpegImagePlugin import JpegImageFile
import folder_paths

def format_file_size(size_in_bytes):
    if size_in_bytes < 1024:
        return f"{size_in_bytes} B"
    elif size_in_bytes < 1024 * 1024:
        return f"{size_in_bytes / 1024:.1f} KB"
    elif size_in_bytes < 1024 * 1024 * 1024:
        return f"{size_in_bytes / (1024 * 1024):.2f} MB"
    else:
        return f"{size_in_bytes / (1024 * 1024 * 1024):.2f} GB"

def parse_comfy_workflow_prompt(prompt_data, workflow_data):
    """Parses standard ComfyUI prompt & workflow dicts to extract common parameters."""
    summary = {
        "positive": "",
        "negative": "",
        "model": "",
        "seed": "",
        "steps": "",
        "cfg": "",
        "sampler": "",
        "scheduler": "",
        "denoise": "",
        "loras": []
    }

    if not isinstance(prompt_data, dict):
        return summary

    pos_texts = []
    neg_texts = []

    for node_id, node in prompt_data.items():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", ""))
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue

        # Check KSampler / Sampler nodes
        if "KSampler" in class_type or "Sampler" in class_type:
            if "seed" in inputs and not summary["seed"]:
                summary["seed"] = str(inputs.get("seed", ""))
            if "steps" in inputs and not summary["steps"]:
                summary["steps"] = str(inputs.get("steps", ""))
            if "cfg" in inputs and not summary["cfg"]:
                summary["cfg"] = str(inputs.get("cfg", ""))
            if "sampler_name" in inputs and not summary["sampler"]:
                summary["sampler"] = str(inputs.get("sampler_name", ""))
            if "scheduler" in inputs and not summary["scheduler"]:
                summary["scheduler"] = str(inputs.get("scheduler", ""))
            if "denoise" in inputs and not summary["denoise"]:
                summary["denoise"] = str(inputs.get("denoise", ""))

        # Check Model Loader nodes
        if "CheckpointLoader" in class_type or "UNETLoader" in class_type or "DiffusionModel" in class_type:
            if "ckpt_name" in inputs and not summary["model"]:
                summary["model"] = str(inputs.get("ckpt_name", ""))
            elif "unet_name" in inputs and not summary["model"]:
                summary["model"] = str(inputs.get("unet_name", ""))

        # Check Lora nodes
        if "LoraLoader" in class_type:
            lora_name = str(inputs.get("lora_name", ""))
            if lora_name:
                strength = inputs.get("strength_model", inputs.get("strength", 1.0))
                summary["loras"].append(f"{lora_name} ({strength})")

        # Check Text / Prompt nodes
        if "CLIPTextEncode" in class_type or "Text" in class_type or "Prompt" in class_type:
            text = inputs.get("text", "")
            if isinstance(text, str) and text.strip():
                # Heuristic: check if connected to positive or negative input of sampler
                # or classify by content
                lower_text = text.lower()
                if "negative" in class_type.lower() or "bad" in lower_text or "worst quality" in lower_text:
                    neg_texts.append(text.strip())
                else:
                    pos_texts.append(text.strip())

    if pos_texts:
        summary["positive"] = "\n\n".join(pos_texts)
    if neg_texts:
        summary["negative"] = "\n\n".join(neg_texts)

    return summary

def extract_image_metadata(image_path):
    """Extracts complete metadata and parsed generation parameters for a single image."""
    if not os.path.isfile(image_path):
        return {"error": f"File not found: {image_path}"}

    stat = os.stat(image_path)
    fileinfo = {
        "filename": os.path.basename(image_path),
        "path": Path(image_path).as_posix(),
        "date": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
        "timestamp": stat.st_mtime,
        "size": format_file_size(stat.st_size),
        "size_bytes": stat.st_size,
        "resolution": "unknown"
    }

    raw_metadata = {}
    prompt = {}
    workflow = {}

    try:
        with Image.open(image_path) as img:
            fileinfo["resolution"] = f"{img.width}x{img.height}"
            fileinfo["width"] = img.width
            fileinfo["height"] = img.height

            if isinstance(img, PngImageFile) and getattr(img, "info", None):
                for k, v in img.info.items():
                    if k == "workflow":
                        if isinstance(v, str):
                            try:
                                workflow = json.loads(v)
                            except Exception:
                                workflow = {"raw": v}
                        elif isinstance(v, dict):
                            workflow = v
                        raw_metadata["workflow"] = workflow
                    elif k == "prompt":
                        if isinstance(v, str):
                            try:
                                prompt = json.loads(v)
                            except Exception:
                                prompt = {"raw": v}
                        elif isinstance(v, dict):
                            prompt = v
                        raw_metadata["prompt"] = prompt
                    else:
                        if isinstance(v, str):
                            try:
                                raw_metadata[str(k)] = json.loads(v)
                            except Exception:
                                raw_metadata[str(k)] = v
                        else:
                            raw_metadata[str(k)] = str(v)

            elif isinstance(img, JpegImageFile):
                exif = img.getexif()
                if exif:
                    for k, v in exif.items():
                        tag = TAGS.get(k, str(k))
                        if v is not None:
                            raw_metadata[str(tag)] = str(v)

                    # Look for UserComment or standard ComfyUI EXIF markers
                    user_comment = raw_metadata.get("UserComment", "")
                    if user_comment and isinstance(user_comment, str):
                        try:
                            parsed_comment = json.loads(user_comment)
                            if "workflow" in parsed_comment:
                                workflow = parsed_comment["workflow"]
                            if "prompt" in parsed_comment:
                                prompt = parsed_comment["prompt"]
                        except Exception:
                            pass

    except Exception as e:
        raw_metadata["extract_error"] = str(e)

    summary = parse_comfy_workflow_prompt(prompt, workflow)

    return {
        "fileinfo": fileinfo,
        "summary": summary,
        "prompt": prompt,
        "workflow": workflow,
        "raw": raw_metadata
    }