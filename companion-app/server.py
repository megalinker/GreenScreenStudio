import os
import uuid
import threading
import subprocess
import json
import re
import base64
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_sock import Sock
import glob
import queue

# --- Configuration ---
_base_dir = os.path.dirname(os.path.abspath(__file__))
JOBS_DIR = os.path.join(_base_dir, "jobs")

if not os.path.exists("jobs"):
    os.makedirs("jobs")

JOBS = {}
JOBS_LOCK = threading.Lock()
TASK_QUEUE = queue.Queue()

# --- Flask App Initialization ---
app = Flask(__name__)
CORS(app)
sock = Sock(app)


# --- Worker Function ---
def worker():
    """
    Pulls tasks from the queue and executes them one by one.
    This function runs in a single, dedicated background thread.
    """
    while True:
        try:
            job_details = TASK_QUEUE.get()
            job_id, source_path, background_path, settings, is_preview = job_details

            print(f"Worker picked up job {job_id}. Starting processing.")
            process_video_task(job_id, source_path, background_path, settings, is_preview)

            TASK_QUEUE.task_done()
            print(f"Worker finished job {job_id}.")

        except Exception as e:
            print(f"An error occurred in the worker thread: {e}")
            if 'job_id' in locals():
                with JOBS_LOCK:
                    if job_id in JOBS:
                        JOBS[job_id]["status"] = "failed"
                        JOBS[job_id]["error"] = "A critical worker error occurred."


# --- Helper Functions ---
def process_video_task(
    job_id, source_path, background_path, settings, is_preview=False
):
    """
    This is the master FFmpeg processing function.
    It dynamically builds a complex command based on extensive user settings.
    Can generate a full export or a fast preview based on the `is_preview` flag.
    """
    job_dir = os.path.join(JOBS_DIR, job_id)
    with JOBS_LOCK:
        if is_preview:
            JOBS[job_id]["status"] = "preview_processing"
        else:
            JOBS[job_id]["status"] = "processing"

    # --- 1. Extract settings with robust defaults ---
    is_transparent = settings.get("transparent", False)
    is_keying_enabled = settings.get("isKeyingEnabled", True)
    output_format = "prores" if is_transparent else settings.get("format", "mp4")
    resolution_key = settings.get("resolution", "original_source")
    transforms = settings.get("transforms", {})
    fg_transform = transforms.get("foreground", {})
    bg_transform = transforms.get("background", {})

    # Trimming settings
    start_time = settings.get("startTime")
    end_time = settings.get("endTime")
    duration = None
    if start_time is not None and end_time is not None:
        duration = end_time - start_time

    loop_behavior = "none" if is_transparent else settings.get("loop", "none")

    # --- 2. Build the FFmpeg Command ---
    command = ["ffmpeg", "-y"]

    # --- 3. Define Inputs and their options ---
    source_input_opts = []
    background_input_opts = []

    if start_time is not None:
        source_input_opts.extend(["-ss", str(start_time)])

    if loop_behavior == "source":
        source_input_opts.extend(["-stream_loop", "-1"])

    if not is_transparent:
        # Background is only used if not exporting transparently
        if background_path and background_path.lower().endswith(
            (".png", ".jpg", ".jpeg")
        ):
            background_input_opts.extend(["-loop", "1"])
        elif loop_behavior == "background":
            background_input_opts.extend(["-stream_loop", "-1"])

    # Add inputs to the main command in the correct order
    if not is_transparent:
        command.extend(background_input_opts)
        command.extend(["-i", background_path])

    command.extend(source_input_opts)
    command.extend(["-i", source_path])

    # --- 4. Build the Complex Filter Graph (The heart of the logic) ---
    filter_complex_parts = []
    with JOBS_LOCK:
        source_props = JOBS.get(job_id, {}).get("sourceProperties", {})
        background_props = JOBS.get(job_id, {}).get("backgroundProperties", {})

    # Determine final canvas resolution
    res_map = {"1080p": (1920, 1080), "720p": (1280, 720), "4k": (3840, 2160)}
    final_w, final_h = 1280, 720
    if resolution_key in res_map:
        final_w, final_h = res_map[resolution_key]
    elif resolution_key == "original_background" and background_props:
        final_w, final_h = background_props["width"], background_props["height"]
    elif resolution_key == "original_source" and source_props:
        final_w, final_h = source_props["width"], source_props["height"]

    # Input stream identifiers
    bg_stream = "[0:v]"
    fg_stream = "[0:v]" if is_transparent else "[1:v]"
    audio_stream = "0:a?" if is_transparent else "1:a?"

    # 4a. Foreground processing (scale and optional chromakey)
    fg_scale = fg_transform.get("scale", 1.0)
    fg_base_w = source_props.get("width", 1)
    fg_base_h = source_props.get("height", 1)
    fg_w = int(fg_base_w * fg_scale)
    fg_h = int(fg_base_h * fg_scale)
    fg_w = fg_w if fg_w % 2 == 0 else fg_w + 1
    fg_h = fg_h if fg_h % 2 == 0 else fg_h + 1

    fg_filter_chain = f"{fg_stream}scale={fg_w}:{fg_h}"
    if is_keying_enabled:
        key_color = settings.get("keyColor", "#00FF00")
        if key_color.startswith("#"):
            key_color = "0x" + key_color[1:]
        similarity = settings.get("similarity", 0.2)
        blend = settings.get("blend", 0.1)
        fg_filter_chain += (
            f",chromakey=color={key_color}:similarity={similarity}:blend={blend}"
        )

    filter_complex_parts.append(f"{fg_filter_chain}[fg_processed]")

    final_video_stream_name = "[outv]"

    if is_transparent:
        # Create a transparent canvas of the final size and overlay the FG
        fg_x = int(fg_transform.get("x", 0))
        fg_y = int(fg_transform.get("y", 0))
        filter_complex_parts.append(
            f"color=c=black@0.0:s={final_w}x{final_h}:r=25,format=yuva444p[base]"
        )
        filter_complex_parts.append(
            f"[base][fg_processed]overlay=x={fg_x}:y={fg_y}{final_video_stream_name}"
        )
    else:
        # Background processing (scale)
        bg_scale = bg_transform.get("scale", 1.0)
        bg_base_w = background_props.get("width", 1)
        bg_base_h = background_props.get("height", 1)
        bg_w = int(bg_base_w * bg_scale)
        bg_h = int(bg_base_h * bg_scale)
        bg_w = bg_w if bg_w % 2 == 0 else bg_w + 1
        bg_h = bg_h if bg_h % 2 == 0 else bg_h + 1
        filter_complex_parts.append(f"{bg_stream}scale={bg_w}:{bg_h}[bg_scaled]")

        # Create a black canvas of the final size
        filter_complex_parts.append(f"color=c=black:s={final_w}x{final_h}[canvas]")

        # Overlay background onto canvas
        bg_x = int(bg_transform.get("x", 0))
        bg_y = int(bg_transform.get("y", 0))
        filter_complex_parts.append(
            f"[canvas][bg_scaled]overlay=x={bg_x}:y={bg_y}[bg_placed]"
        )

        # Overlay foreground onto the result
        fg_x = int(fg_transform.get("x", 0))
        fg_y = int(fg_transform.get("y", 0))
        overlay_options = "shortest=1" if duration is None else ""
        filter_complex_parts.append(
            f"[bg_placed][fg_processed]overlay=x={fg_x}:y={fg_y}:{overlay_options}{final_video_stream_name}"
        )

    command.extend(["-filter_complex", ";".join(filter_complex_parts)])
    command.extend(["-map", final_video_stream_name])
    command.extend(["-map", audio_stream])

    # --- 5. Define Output Settings ---
    if duration and duration > 0:
        command.extend(["-t", str(duration)])

    if is_preview:
        output_extension = "mp4"
        command.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "28",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
            ]
        )
        output_path = os.path.join(job_dir, f"preview.{output_extension}")
    elif output_format == "prores":
        output_extension = "mov"
        if is_transparent:
            command.extend(
                [
                    "-c:v",
                    "prores_ks",
                    "-profile:v",
                    "4",
                    "-pix_fmt",
                    "yuva444p",
                    "-c:a",
                    "pcm_s16le",
                ]
            )
        else:
            command.extend(
                ["-c:v", "prores_ks", "-profile:v", "3", "-c:a", "pcm_s16le"]
            )
    elif output_format == "webm":
        output_extension = "webm"
        command.extend(
            ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-c:a", "libopus"]
        )
    elif output_format == "gif":
        output_extension = "gif"
        command.extend(
            ["-vf", "fps=15,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"]
        )
        audio_map_index = command.index("-map", command.index(audio_stream) - 1)
        command.pop(audio_map_index + 1)
        command.pop(audio_map_index)
    else:  # Default to MP4
        output_extension = "mp4"
        command.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "23",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
            ]
        )

    if not is_preview:
        output_path = os.path.join(job_dir, f"output.{output_extension}")

    command.append(output_path)

    # --- 6. Execute and Monitor the FFmpeg Process ---
    print(f"Executing FFmpeg command for job {job_id}: {' '.join(command)}")

    with JOBS_LOCK:
        progress_duration = (
            duration
            if duration and duration > 0
            else JOBS[job_id].get("sourceProperties", {}).get("duration", 1)
        )
    if progress_duration <= 0:
        progress_duration = 1  # Avoid division by zero

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        universal_newlines=True,
    )
    time_regex = re.compile(r"time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})")

    for line in process.stdout:
        match = time_regex.search(line)
        if match:
            hours, minutes, seconds, hundredths = map(int, match.groups())
            current_time = hours * 3600 + minutes * 60 + seconds + hundredths / 100
            progress = (current_time / progress_duration) * 100
            with JOBS_LOCK:
                JOBS[job_id]["progress"] = min(round(progress, 2), 100)

    process.wait()

    with JOBS_LOCK:
        if process.returncode == 0:
            if is_preview:
                JOBS[job_id].update(
                    {
                        "status": "preview_completed",
                        "progress": 100,
                        "previewPath": output_path,
                    }
                )
            else:
                JOBS[job_id].update(
                    {"status": "completed", "progress": 100, "outputPath": output_path}
                )
        else:
            JOBS[job_id].update(
                {
                    "status": "failed",
                    "error": f"FFmpeg failed with exit code {process.returncode}. Check logs for details.",
                }
            )


def generate_preview_frame(job_id, settings):
    with JOBS_LOCK:
        job = JOBS.get(job_id)

    if not job:
        print(f"Preview Error: Job {job_id} not found.")
        return None

    job_dir = os.path.join(JOBS_DIR, job_id)
    source_path_list = glob.glob(os.path.join(job_dir, "source_video.*"))
    if not source_path_list:
        print(f"Preview Error: Source video file not found for job {job_id}.")
        return None
    source_path = source_path_list[0]

    # 1. Extract a single frame from the source video
    preview_base_frame_path = os.path.join(job_dir, "preview_base.png")
    duration = job.get("sourceProperties", {}).get("duration", 0)

    timestamp_seconds = settings.get("timestamp")
    if timestamp_seconds is None:
        timestamp_seconds = max(1, duration * 0.1) if duration and duration > 1 else 0

    extract_command = [
        "ffmpeg",
        "-y",
        "-ss",
        str(timestamp_seconds),
        "-i",
        source_path,
        "-vframes",
        "1",
        preview_base_frame_path,
    ]
    extract_proc = subprocess.run(extract_command, capture_output=True, text=True)
    if extract_proc.returncode != 0:
        print(f"Preview Error: Failed to extract base frame for job {job_id}.")
        print(f"FFmpeg stderr: {extract_proc.stderr}")
        return None

    # 2. Build and execute the keying/scaling command
    output_image_path = os.path.join(job_dir, "preview_keyed.png")
    command = ["ffmpeg", "-y", "-i", preview_base_frame_path]

    transforms = settings.get("transforms", {})
    fg_transform = transforms.get("foreground", {})
    source_props = job.get("sourceProperties", {})

    is_previewing_color_pick = settings.get("isPreviewingColorPick", False)
    is_keying_enabled = settings.get("isKeyingEnabled", True)

    fg_scale = fg_transform.get("scale", 1.0)
    fg_base_w = source_props.get("width", 1)
    fg_base_h = source_props.get("height", 1)
    fg_w = int(fg_base_w * fg_scale)
    fg_h = int(fg_base_h * fg_scale)
    fg_w = fg_w if fg_w % 2 == 0 else fg_w + 1
    fg_h = fg_h if fg_h % 2 == 0 else fg_h + 1

    # Conditionally build the filter graph.
    filter_chain_parts = [f"[0:v]scale={fg_w}:{fg_h}"]

    if not is_previewing_color_pick and is_keying_enabled:
        key_color = settings.get("keyColor", "#00FF00")
        if key_color.startswith("#"):
            key_color = "0x" + key_color[1:]
        similarity = settings.get("similarity", 0.2)
        blend = settings.get("blend", 0.1)
        filter_chain_parts.append(
            f"chromakey=color={key_color}:similarity={similarity}:blend={blend}"
        )

    filter_chain_parts.append("format=yuva444p")
    filter_complex = f"{','.join(filter_chain_parts)}[out]"

    command.extend(["-filter_complex", filter_complex])
    command.extend(["-map", "[out]"])
    command.append(output_image_path)

    compose_proc = subprocess.run(command, capture_output=True, text=True)

    if compose_proc.returncode == 0 and os.path.exists(output_image_path):
        with open(output_image_path, "rb") as f:
            encoded_string = base64.b64encode(f.read()).decode("utf-8")
        try:
            os.remove(preview_base_frame_path)
            os.remove(output_image_path)
        except OSError as e:
            print(f"Error cleaning up preview files: {e}")
        return f"data:image/png;base64,{encoded_string}"
    else:
        print(f"Preview Error: Keyed PNG could not be created for job {job_id}.")
        print(f"FFmpeg command: {' '.join(command)}")
        print(f"FFmpeg stderr: {compose_proc.stderr}")
        return None


# --- API Endpoints ---


@sock.route("/api/preview")
def preview_socket(ws):
    print("WebSocket connection established.")
    job_id = None

    while True:
        try:
            data = ws.receive()
            message = json.loads(data)

            if message.get("type") == "init":
                job_id = message["jobId"]
                print(f"Initialized preview for job {job_id}.")

            elif message.get("type") == "update" and job_id:
                settings = message["settings"]
                image_data = generate_preview_frame(job_id=job_id, settings=settings)

                if image_data:
                    ws.send(json.dumps({"type": "preview_frame", "image": image_data}))
                else:
                    ws.send(
                        json.dumps(
                            {"type": "error", "message": "Failed to generate preview."}
                        )
                    )

        except Exception as e:
            print(f"WebSocket error or client disconnected: {e}")
            break

    print("WebSocket connection closed.")


@app.route("/health", methods=["GET"])
def health_check():
    return jsonify({"status": "ok", "message": "Companion app is running!"}), 200


@app.route("/api/process", methods=["POST"])
def process_video_endpoint():
    is_transparent = request.form.get("isTransparent") == "true"

    if "sourceVideo" not in request.files:
        return jsonify({"error": "A source video file is always required."}), 400
    if "sourceProperties" not in request.form:
        return jsonify({"error": "Source properties are required."}), 400

    if not is_transparent and "background" not in request.files:
        return (
            jsonify(
                {"error": "A background file is required for non-transparent exports."}
            ),
            400,
        )
    if not is_transparent and "backgroundProperties" not in request.form:
        return jsonify({"error": "Background properties are required."}), 400

    video_file = request.files["sourceVideo"]
    background_file = request.files.get("background")

    try:
        source_props = json.loads(request.form["sourceProperties"])
    except (json.JSONDecodeError, KeyError):
        return jsonify({"error": "Invalid source properties format."}), 400

    job_id = str(uuid.uuid4())
    job_dir = os.path.join(JOBS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    # Save source video with its extension
    _, source_ext = os.path.splitext(video_file.filename)
    source_path = os.path.join(job_dir, f"source_video{source_ext}")
    video_file.save(source_path)

    job_data = {
        "id": job_id,
        "status": "uploaded",
        "progress": 0,
        "settings": {},
        "sourceProperties": source_props,
    }

    if background_file:
        try:
            background_props = json.loads(request.form["backgroundProperties"])
        except (json.JSONDecodeError, KeyError):
            return jsonify({"error": "Invalid background properties format."}), 400

        _, background_ext = os.path.splitext(background_file.filename)
        background_path = os.path.join(job_dir, f"background{background_ext}")
        background_file.save(background_path)
        job_data["backgroundProperties"] = background_props

    with JOBS_LOCK:
        JOBS[job_id] = job_data
    return jsonify({"jobId": job_id}), 200


@app.route("/api/process-preview/<job_id>", methods=["POST"])
def process_preview_endpoint(job_id):
    with JOBS_LOCK:
        if job_id not in JOBS:
            return jsonify({"error": "Job not found. Please upload files first."}), 404

    settings = request.get_json()
    if not settings:
        return jsonify({"error": "Missing settings in request body"}), 400

    is_transparent = settings.get("transparent", False)
    job_dir = os.path.join(JOBS_DIR, job_id)

    # Find files dynamically
    source_path_list = glob.glob(os.path.join(job_dir, "source_video.*"))
    if not source_path_list:
        return jsonify({"error": "Source file missing on server."}), 500
    source_path = source_path_list[0]

    background_path = None
    if not is_transparent:
        background_path_list = glob.glob(os.path.join(job_dir, "background.*"))
        if not background_path_list:
            return (
                jsonify(
                    {
                        "error": "Background file missing on server for non-transparent export."
                    }
                ),
                500,
            )
        background_path = background_path_list[0]

    with JOBS_LOCK:
        JOBS[job_id].update(
            {"status": "preview_queued", "progress": 0, "settings": settings}
        )

    task_details = (job_id, source_path, background_path, settings, True)
    TASK_QUEUE.put(task_details)

    return jsonify({"message": "Preview has been queued."}), 202


@app.route("/api/export/<job_id>", methods=["POST"])
def export_video_endpoint(job_id):
    with JOBS_LOCK:
        if job_id not in JOBS:
            return jsonify({"error": "Job not found. Please upload files first."}), 404

    settings = request.get_json()
    if not settings:
        return jsonify({"error": "Missing settings in request body"}), 400

    is_transparent = settings.get("transparent", False)
    job_dir = os.path.join(JOBS_DIR, job_id)

    # Find files dynamically
    source_path_list = glob.glob(os.path.join(job_dir, "source_video.*"))
    if not source_path_list:
        return jsonify({"error": "Source file missing on server."}), 500
    source_path = source_path_list[0]

    background_path = None
    if not is_transparent:
        background_path_list = glob.glob(os.path.join(job_dir, "background.*"))
        if not background_path_list:
            return (
                jsonify(
                    {
                        "error": "Background file missing on server for non-transparent export."
                    }
                ),
                500,
            )
        background_path = background_path_list[0]

    with JOBS_LOCK:
        JOBS[job_id].update({"status": "queued", "progress": 0, "settings": settings})

    task_details = (job_id, source_path, background_path, settings, False)
    TASK_QUEUE.put(task_details)

    return jsonify({"message": "Export has been queued."}), 202


@app.route("/api/status/<job_id>", methods=["GET"])
def get_status(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job = job.copy()

    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route("/api/preview-video/<job_id>", methods=["GET"])
def download_preview_video(job_id):
    path_to_file = None
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job and job.get("status") == "preview_completed":
            path_to_file = job.get("previewPath")

    if not path_to_file:
        return jsonify({"error": "Preview not found or not completed"}), 404

    job_dir = os.path.dirname(path_to_file)
    preview_filename = os.path.basename(path_to_file)

    return send_from_directory(job_dir, preview_filename, as_attachment=False)


@app.route("/api/download/<job_id>", methods=["GET"])
def download_file(job_id):
    path_to_file = None
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job and job.get("status") == "completed":
            path_to_file = job.get("outputPath")

    if not path_to_file:
        return jsonify({"error": "Job not found or not completed"}), 404
    
    job_dir = os.path.dirname(path_to_file)
    output_filename = os.path.basename(path_to_file)

    return send_from_directory(job_dir, output_filename, as_attachment=True)


if __name__ == "__main__":
    worker_thread = threading.Thread(target=worker, daemon=True)
    worker_thread.start()

    app.run(host="0.0.0.0", port=5000)