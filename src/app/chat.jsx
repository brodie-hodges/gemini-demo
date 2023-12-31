"use client";

import { useId, useEffect, useRef, useState } from "react";
import { useChat } from   "ai/react";
import useSilenceAwareRecorder from "silence-aware-recorder/react";
import useMediaRecorder from "@wmik/use-media-recorder";
import mergeImages from "merge-images";
import { isStatement } from "typescript";

const INTERVAL = 250;
const IMAGE_WIDTH = 512;
const IMAGE_QUALITY = 0.6;
const COLUMNS = 4;
const MAX_SCREENSHOTS = 60;
const SILENCE_DURATION = 2500;
const SILENT_THRESHOLD = -30;

const transparentPixel = 
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/+t/PQAJcQN5yDP2ywAAAABJRU5ErkJggg=="

function playAudio(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.onended = resolve;
    audio.play();
  });
}

async function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const img = new globalThis.Image();

    img.onload = function() {
      resolve({
        width: this.width,
        height: this.height,
      });
    };

    img.onerror = function() {
      reject(new Error("Failed to load image."));
    };

    img.src = src;
  });
}

function base64ToBlob(base64, mimeType) {
  const byteCharacters = atob(base64.split(",")[1]);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

async function uploadImageToFreeImageHost(base64Image) {
  const blob = base64ToBlob(base64Image, "image/jpeg");
  const formData = new FormData();
  formData.append("file", blob, "image.jpeg");

  const response = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: formData,
  });

  const { data } = await response.json();

  return data.url.replace("https://tmpfiles.org/", "https://tmpfiles.org/dl/");
}

async function imagesGrid({
  base64Images,
  columns = COLUMNS,
  gridImageWidth = IMAGE_WIDTH,
  quality = IMAGE_QUALITY,
}) {
  if (!base64Images.length) {
    return transparentPixel;
  }

  const dimensions = await getImageDimensions(base64Images[0]);

  // Calculate the aspect ratio of the first image
  const aspectRatio = dimensions.width / dimensions.height;

  const gridImageHeight = gridImageWidth / aspectRatio;

  const rows = Math.ceil(base64Images.length / columns); 

  // Prepare the images for merging
  const imagesWithCoordinates = base64Images.map((src, idx) => ({
    src,
    x: (idx % columns) * gridImageWidth,
    y: Math.floor(idx / columns) * gridImageHeight,
  }));

  // Merge images into a single base64 string
  return await mergeImages(imagesWithCoordinates, {
    format: "image/jpeg",
    quality,
    width: columns * gridImageWidth,
    height: rows * gridImageHeight,
  });
}

export default function Chat() {
  const id = useId();
  const maxVolumeRef = useRef(0);
  const minVolumeRef = useRef(-100);
  const isBusy = useRef(false);
  const screenshotsRef = useRef([]);
  const videoRef = useRef();
  const canvasRef = useRef();
  const [displayDebug, setDisplayDebug] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [phase, setPhase] = useState("not inited");
  const [transcription, setTranscription] = useState("");
  const [imagesGridUrl, setImagesGridUrl] = useState(null);
  const [currentVolume, setCurrentVolume] = useState(-50);
  const [volumePercentage, setVolumePercentage] = useState(0);

  let { liveStream, ...video } = useMediaRecorder({
    recordScreen: false,
    blobOptions: { type: "video/webm" },
    mediaStreamConstraints: { audio: false, video: true },
  });

  const audio = useSilenceAwareRecorder({
    onDataAvailable: onSpeech,
    onVolumeChange: setCurrentVolume,
    silenceDuration: SILENCE_DURATION,
    silentThreshold: SILENT_THRESHOLD,
    minDecibels: -100,
  });

  function startRecording() {
    audio.startRecording();
    video.startRecording();

    setIsStarted(true);
    setPhase("user: waiting for speech");
  }

  function stopRecording() {
    document.location.reload();
  }

  async function onSpeech(data) {
    if (isBusy.current) return;

    isBusy.current = true;
    audio.stopRecording();

    // send audio to whisper for transcription
    setPhase("user: processing speech to text");

    const token = null;
    const lang = "en";

    const speechtotextFormData = new FormData();
    speechtotextFormData.append("file", data, "audio.webm");
    speechtotextFormData.append("token", token);
    speechtotextFormData.append("lang", lang);

    const speechtotextResponse = await fetch("/api/speechtotext", {
      method: "POST",
      body: speechtotextFormData,
    });

    const { text, error } = await speechtotextResponse.json();

    if (error) {
      alert(error);
    }

    setTranscription(text);

    // generate image grid
    setPhase("user: uploading video captures");

    // keep only last n screenshots
    screenshotsRef.current = screenshotsRef.current.slice(-MAX_SCREENSHOTS);

    const imageUrl = await imagesGrid({
      base64Images: screenshotsRef.current,
    });

    screenshotsRef.current = [];

    const uploadUrl = await uploadImageToFreeImageHost(imageUrl);

    setImagesGridUrl(imageUrl);

    setPhase("user: processing completion");

    await append({
      content: [
        text,
        {
          type: "image_url",
          image_url: {
            url: uploadUrl,
          },
        },
      ],
      role: "user",
    });
  }

  const { messages, append, reload, isLoading } = useChat({
    id,
    body: {
      id,
      token: null,
      lang: 'en',
    },
    async onFinish(message) {
      setPhase("assistant: processing text to speech");

      const token = null;

      const texttospeechFormData = new FormData();
      texttospeechFormData.append("input", message.content);
      texttospeechFormData.append("token", token);

      const response = await fetch("/api/texttospeech", {
        method: "POST",
        body: texttospeechFormData,
      });

      setPhase("assistant: playing audio");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      await playAudio(url);

      audio.startRecording();
      isBusy.current = false;

      setPhase("user: waiting for speech");
    }
  })

  useEffect(() => {
    if (videoRef.current && liveStream && !videoRef.current.srcObject) {
      videoRef.current.srcObject = liveStream;
    }
  }, [liveStream]);

  useEffect(() => {
    const captureFrame = () => {
      if (video.status === "recording" && audio.isRecording) {
        const targetWidth = IMAGE_WIDTH;

        const videoNode = videoRef.current;
        const canvasNode = canvasRef.current;

        if (videoNode && canvasNode) {
          const context = canvasNode.getContext("2d");
          const originalWidth = videoNode.videoWidth;
          const originalHeight = videoNode.videoHeight;
          const aspectRatio = originalHeight / originalWidth;

          // set new width while maintaining aspect ratio
          canvasNode.width = targetWidth;
          canvasNode.height = targetWidth * aspectRatio;

          context.drawImage(
            videoNode,
            0,
            0,
            canvasNode.width,
            canvasNode.height
          );
          // compress and convert image to JPEG format
          const quality = 1; // adjust quality as needed between 0 and 1
          const base64Image = canvasNode.toDataURL("image/jpeg", quality);

          if (base64Image !== "data:,") {
            screenshotsRef.current.push(base64Image);
          }
        }
      }
    };

    const intervalId = setInterval(captureFrame, INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [video.status, audio.isRecording]);

  useEffect(() => {
    if (!audio.isRecording) {
      setVolumePercentage(0);
      return;
    }

    if (typeof currentVolume === "number" && isFinite(currentVolume)) {
      if (currentVolume > maxVolumeRef.current) {
        maxVolumeRef.current = currentVolume;
      }
      if (currentVolume < minVolumeRef.current) {
        minVolumeRef.current = currentVolume;
      }
      
      if (maxVolumeRef.current !==  minVolumeRef.current) {
        setVolumePercentage(
          (currentVolume - minVolumeRef.current) / (maxVolumeRef.current - minVolumeRef.current)
        );
      }
    }
  }, [currentVolume, audio.isRecording]);

  const lastAssistantMessage = messages.filter((it) => it.role === "assistant").pop();

  return (
    <>
      <canvas ref={canvasRef} style={{ display: "none"}} />
      <div className="flex flex-col h-screen bg-black">
        <div className="flex flex-1 md:flex-row">
          
          {/* Main Content Section */}
          <div className="w-full md:w-2/3 bg-black p-4">
            {/* Main content goes here */}
            <video
              ref={videoRef}
              className="h-auto w-full aspect-[4/3] object-cover rounded-[1rem] bg-gray-900"
              autoPlay
            />
            {audio.isRecording ? (
              <div className="w-16 h-16 relative -top-24 left-4 flex justify-center items-center">
                <div 
                  className="w-16 h-16 bg-red-500 opacity-50 rounded-full"
                  style={{
                    transform: `scale(${Math.pow(volumePercentage, 4).toFixed(4)})`
                  }}
                ></div>
              </div>
            ) : (
              <div className="w-16 h-16 relative -top-24 left-4 flex justify-center items-center cursor-pointer">
                <div className="text-5xl text-red-500 opacity-50" >⏸</div>
              </div>
            )}
            <div
              className={`bg-[rgba(20,20,20,0.8)] h-full backdrop-blur-xl p-8 rounded-sm absolute left-0 top-0 bottom-0 right-1/2 ${displayDebug ? "translate-x-0" : "-translate-x-full"}`}
            >
              <div
              className="absolute z-10 top-4 right-4 opacity-50 cursor-pointer"
              onClick={() => setDisplayDebug(false)}
              >X</div>
              <div className="space-y-8">
                <div className="space-y-2">
                    <div className="font-semibold text-white opacity-50">Phase:</div>
                    <p className="text-white">{phase}</p>
                </div>
                <div className="space-y-2">
                    <div className="font-semibold text-white opacity-50">Transcript:</div>
                    <p className="text-white">{transcription || "--"}</p>
                </div>
                <div className="space-y-2">
                  <div className="font-semibold text-white opacity-50">Captures:</div>
                  <img
                    className="object-contain w-full border border-gray-500"
                    alt="Grid"
                    src={imagesGridUrl || transparentPixel}
                  />
                </div>
              </div>
            </div>
          </div>
          {/* Chat Section */}
          <div className="w-full md:w-1/3 bg-black p-4 flex justify-center items-center" >
            {/* Chat content goes here */}
            {isLoading ? (
              <div className="w-8 h-8">
                <div className="w-6 h-6 -mr-3 -mt-3 rounded-full bg-cyan-500 animate-ping" />
              </div>
            ) : (
              <div>{lastAssistantMessage?.content}</div>
            )}
          </div>
        </div>

        {/* Fixed Bottom Buttons Section */}
        <div className="fixed inset-x-0 bottom-0 bg-white dark:bg-gray-900 p-4">
          {/* Buttons go here */}
          {isStarted ? (
              <button
                className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
                onClick={stopRecording}
              >
                Stop session
              </button>
            ) : (
              <button
                className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
                onClick={startRecording}
              >
                Start session
              </button>
            )}
            <button
                className="px-4 py-2 bg-gray-700 rounded-md disabled:opacity-50"
                onClick={() => setDisplayDebug((p) => !p)}
              >
              Debug
            </button>
        </div>
      </div>
    </>
  )
}
