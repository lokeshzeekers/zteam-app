import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';

// STUN is enough on most networks. If people on different networks / strict
// firewalls can't see or hear each other, add a TURN server in client/.env:
//   VITE_TURN_URL=turn:your-server:3478   VITE_TURN_USERNAME=...   VITE_TURN_CREDENTIAL=...
function buildRtcConfig() {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) {
    iceServers.push({
      urls: turn.split(',').map((u) => u.trim()),
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return { iceServers };
}
const RTC_CONFIG = buildRtcConfig();

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const MicIcon = () => <Icon><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></Icon>;
const MicOffIcon = () => <Icon><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></Icon>;
const VideoIcon = () => <Icon><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Icon>;
const VideoOffIcon = () => <Icon><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><line x1="1" y1="1" x2="23" y2="23" /></Icon>;
const LeaveIcon = () => <Icon><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><line x1="23" y1="1" x2="1" y2="23" /></Icon>;

// One participant. Remote media is attached through a stream held in state, so
// it works no matter whether the track arrives before or after the tile renders.
function MediaTile({ stream, name, isVideoMeeting, isLocal, audioMuted, videoOff }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== (stream || null)) el.srcObject = stream || null;
    if (stream) el.play?.().catch(() => { /* autoplay blocked - user gesture will resume it */ });
  }, [stream, isVideoMeeting]);

  const hasVideoTrack = !!stream && stream.getVideoTracks().length > 0;
  const showVideo = isVideoMeeting && hasVideoTrack && !videoOff;

  return (
    <div className="meeting-tile">
      {isVideoMeeting && (
        <video ref={ref} autoPlay playsInline muted={isLocal} className={`${isLocal ? 'mirrored' : ''} ${showVideo ? '' : 'video-hidden'}`} />
      )}
      {/* Audio-only meetings still need an element to actually play the remote sound. */}
      {!isVideoMeeting && !isLocal && <audio ref={ref} autoPlay />}
      {!showVideo && <div className="meeting-avatar">{(name || '?').trim()[0]?.toUpperCase()}</div>}
      <div className="meeting-tile-label">
        {name}{audioMuted && <MicOffIcon />}
      </div>
    </div>
  );
}

function humanMediaError(err) {
  if (err?.message === 'INSECURE') {
    return "Your browser blocks the camera/microphone on this address. Open Zteam over HTTPS (or localhost) to speak in meetings.";
  }
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera/microphone permission was denied. Allow access in your browser to speak in this meeting.';
    case 'NotFoundError':
      return 'No microphone or camera was found on this device.';
    case 'NotReadableError':
      return 'Your camera/microphone is being used by another application.';
    default:
      return 'Could not access your camera/microphone.';
  }
}

async function getLocalMedia(wantsVideo) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('INSECURE');
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo }), notice: '' };
  } catch (err) {
    // No/blocked camera shouldn't lock someone out of a video meeting - fall back to audio.
    if (wantsVideo && err?.name !== 'NotAllowedError' && err?.name !== 'SecurityError') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        return { stream, notice: 'Your camera is not available, so you joined with audio only.' };
      } catch (err2) { throw err2; }
    }
    throw err;
  }
}

export default function MeetingRoom() {
  const { id } = useParams();
  const meetingId = Number(id);
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState(null);
  const [fatal, setFatal] = useState(null); // { title, message } - replaces the whole screen
  const [notice, setNotice] = useState('');
  const [joined, setJoined] = useState(false);
  const [socketUp, setSocketUp] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [peers, setPeers] = useState({}); // userId -> { name, stream, audioMuted, videoOff }
  const [ending, setEnding] = useState(false);

  const localStreamRef = useRef(null);
  const pcsRef = useRef({}); // userId -> RTCPeerConnection
  const pendingIceRef = useRef({}); // userId -> candidates that arrived before the remote description
  const nameMapRef = useRef({});
  const joinedRef = useRef(false);
  const muteStateRef = useRef({ audioMuted: false, videoOff: false });
  const isVideoMeetingRef = useRef(true);
  const leaveRef = useRef(() => {});

  const setPeer = useCallback((userId, patch) => {
    setPeers((p) => ({
      ...p,
      [userId]: { name: nameMapRef.current[userId] || 'Member', ...(p[userId] || {}), ...patch },
    }));
  }, []);

  const removePeer = useCallback((userId) => {
    pcsRef.current[userId]?.close();
    delete pcsRef.current[userId];
    delete pendingIceRef.current[userId];
    setPeers((p) => { const next = { ...p }; delete next[userId]; return next; });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    if (!socket) {
      setFatal({ title: 'Not connected', message: 'You are not connected to the server. Please refresh the page and sign in again.' });
      return undefined;
    }

    // ---------- WebRTC helpers ----------
    function makePeerConnection(otherId) {
      pcsRef.current[otherId]?.close(); // a rejoining peer gets a brand-new connection
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pendingIceRef.current[otherId] = [];

      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('meeting-webrtc-ice-candidate', { meetingId, to: otherId, candidate: e.candidate });
      };
      pc.ontrack = (e) => {
        const stream = e.streams[0] || new MediaStream([e.track]);
        setPeer(otherId, { stream });
      };
      const local = localStreamRef.current;
      if (local) local.getTracks().forEach((t) => pc.addTrack(t, local));

      pcsRef.current[otherId] = pc;
      return pc;
    }

    async function flushIce(otherId, pc) {
      const queued = pendingIceRef.current[otherId] || [];
      pendingIceRef.current[otherId] = [];
      for (const c of queued) { try { await pc.addIceCandidate(c); } catch (e) { /* stale candidate */ } }
    }

    async function connectToExistingPeer(otherId) {
      const pc = makePeerConnection(otherId);
      // Even with no mic/camera of our own, still be able to receive theirs.
      const local = localStreamRef.current;
      if (!local || local.getAudioTracks().length === 0) pc.addTransceiver('audio', { direction: 'recvonly' });
      if (isVideoMeetingRef.current && (!local || local.getVideoTracks().length === 0)) pc.addTransceiver('video', { direction: 'recvonly' });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('meeting-webrtc-offer', { meetingId, to: otherId, offer: pc.localDescription });
    }

    // Tell the server we're in; it answers with who is already there and we call each of them.
    function joinRoom() {
      return new Promise((resolve) => {
        socket.emit('meeting-join', { meetingId }, async (ack) => {
          if (cancelled) { if (ack?.ok) socket.emit('meeting-leave', { meetingId }); resolve(false); return; }
          if (!ack || ack.error) {
            setFatal({ title: "Can't join this meeting", message: ack?.error || 'The server did not respond. Please try again.' });
            resolve(false);
            return;
          }
          joinedRef.current = true;
          setJoined(true);
          for (const otherId of ack.existingPeers || []) {
            setPeer(otherId, {});
            try { await connectToExistingPeer(otherId); } catch (err) { console.error('Could not connect to peer', otherId, err); }
          }
          // Let everyone already inside know if we joined muted.
          const { audioMuted: am, videoOff: vo } = muteStateRef.current;
          if (am || vo) socket.emit('meeting-mute-update', { meetingId, audioMuted: am, videoMuted: vo });
          resolve(true);
        });
      });
    }

    // ---------- Socket events ----------
    const onPeerJoined = ({ userId, name }) => {
      nameMapRef.current[userId] = name;
      setPeer(userId, { name });
      // The newcomer sends us an offer; share our mute state so their tile is correct.
      const { audioMuted: am, videoOff: vo } = muteStateRef.current;
      if (am || vo) socket.emit('meeting-mute-update', { meetingId, audioMuted: am, videoMuted: vo });
    };
    const onOffer = async ({ meetingId: mid, from, offer }) => {
      if (mid !== meetingId) return;
      try {
        const pc = makePeerConnection(from);
        await pc.setRemoteDescription(offer);
        await flushIce(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('meeting-webrtc-answer', { meetingId, to: from, answer: pc.localDescription });
        setPeer(from, {});
      } catch (err) { console.error('Failed to answer offer', err); }
    };
    const onAnswer = async ({ meetingId: mid, from, answer }) => {
      if (mid !== meetingId) return;
      const pc = pcsRef.current[from];
      if (!pc) return;
      try { await pc.setRemoteDescription(answer); await flushIce(from, pc); } catch (err) { console.error('Failed to apply answer', err); }
    };
    const onIce = async ({ meetingId: mid, from, candidate }) => {
      if (mid !== meetingId) return;
      const pc = pcsRef.current[from];
      // Candidates can beat the offer/answer over the wire - hold them until we can use them.
      if (!pc || !pc.remoteDescription) {
        (pendingIceRef.current[from] ||= []).push(candidate);
        return;
      }
      try { await pc.addIceCandidate(candidate); } catch (err) { /* ignore stale candidate */ }
    };
    const onPeerLeft = ({ userId }) => removePeer(userId);
    const onMuteUpdate = ({ userId, audioMuted: am, videoMuted: vm }) => setPeer(userId, { audioMuted: am, videoOff: vm });
    const onEnded = ({ meetingId: mid, title, cancelled: wasCancelled }) => {
      if (mid !== meetingId) return;
      teardown();
      setFatal({
        title: wasCancelled ? 'Meeting cancelled' : 'Meeting ended',
        message: wasCancelled ? `"${title}" was cancelled by the host.` : 'The host ended this meeting for everyone.',
      });
    };
    const onDisconnect = () => setSocketUp(false);
    const onConnect = () => {
      setSocketUp(true);
      // A new socket has no room membership - re-enter and re-call everyone.
      if (joinedRef.current) joinRoom();
    };

    socket.on('meeting-peer-joined', onPeerJoined);
    socket.on('meeting-webrtc-offer', onOffer);
    socket.on('meeting-webrtc-answer', onAnswer);
    socket.on('meeting-webrtc-ice-candidate', onIce);
    socket.on('meeting-peer-left', onPeerLeft);
    socket.on('meeting-mute-update', onMuteUpdate);
    socket.on('meeting-ended', onEnded);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    setSocketUp(socket.connected);

    function teardown() {
      if (joinedRef.current) {
        socket.emit('meeting-leave', { meetingId });
        joinedRef.current = false;
      }
      Object.values(pcsRef.current).forEach((pc) => pc.close());
      pcsRef.current = {};
      pendingIceRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    leaveRef.current = () => { teardown(); navigate('/meetings'); };

    // ---------- Join flow ----------
    async function start() {
      try {
        const { data } = await api.get('/api/meetings');
        if (cancelled) return;
        const found = data.meetings.find((m) => m.id === meetingId);
        if (!found) {
          setFatal({ title: 'Meeting not found', message: "This meeting doesn't exist any more, or you weren't invited to it." });
          return;
        }
        if (found.status === 'ended' || found.status === 'cancelled') {
          setFatal({ title: 'Meeting over', message: `This meeting has ${found.status}.` });
          return;
        }
        if (found.status === 'scheduled' && !found.isOwner) {
          setFatal({ title: 'Not started yet', message: 'The host has not started this meeting yet. You can join as soon as it goes live.' });
          return;
        }
        setMeeting(found);
        found.participants.forEach((p) => { nameMapRef.current[p.id] = p.name; });
        const wantsVideo = found.callType === 'video';
        isVideoMeetingRef.current = wantsVideo;

        // Get the mic/camera - but never let a media problem stop someone from
        // joining: they enter as a listener/viewer and are told why.
        try {
          const { stream, notice: n } = await getLocalMedia(wantsVideo);
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          localStreamRef.current = stream;
          setLocalStream(stream);
          if (n) setNotice(n);
        } catch (mediaErr) {
          if (cancelled) return;
          setNotice(`${humanMediaError(mediaErr)} You joined as a viewer.`);
        }

        await joinRoom();
      } catch (err) {
        if (cancelled) return;
        setFatal({ title: "Can't join this meeting", message: err?.response?.data?.error || 'Something went wrong while joining. Please try again.' });
      }
    }
    start();

    return () => {
      cancelled = true;
      socket.off('meeting-peer-joined', onPeerJoined);
      socket.off('meeting-webrtc-offer', onOffer);
      socket.off('meeting-webrtc-answer', onAnswer);
      socket.off('meeting-webrtc-ice-candidate', onIce);
      socket.off('meeting-peer-left', onPeerLeft);
      socket.off('meeting-mute-update', onMuteUpdate);
      socket.off('meeting-ended', onEnded);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      teardown(); // also runs when leaving with the browser back button
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  // ---------- Controls ----------
  const hasAudio = !!localStream && localStream.getAudioTracks().length > 0;
  const hasVideo = !!localStream && localStream.getVideoTracks().length > 0;

  function toggleAudio() {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const muted = !track.enabled;
    setAudioMuted(muted);
    muteStateRef.current.audioMuted = muted;
    getSocket()?.emit('meeting-mute-update', { meetingId, audioMuted: muted, videoMuted: muteStateRef.current.videoOff });
  }

  function toggleVideo() {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const off = !track.enabled;
    setVideoOff(off);
    muteStateRef.current.videoOff = off;
    getSocket()?.emit('meeting-mute-update', { meetingId, audioMuted: muteStateRef.current.audioMuted, videoMuted: off });
  }

  async function endForEveryone() {
    if (!confirm('End this meeting for everyone?')) return;
    setEnding(true);
    try {
      await api.post(`/api/meetings/${meetingId}/end`);
      // The server's 'meeting-ended' event (which we also receive) shows the ended screen.
    } catch (err) {
      setEnding(false);
      setNotice(err?.response?.data?.error || 'Could not end the meeting.');
    }
  }

  if (fatal) {
    return (
      <div className="meeting-message">
        <div className="meeting-message-card">
          <h3>{fatal.title}</h3>
          <p>{fatal.message}</p>
          <button type="button" className="primary-btn" onClick={() => navigate('/meetings')}>Back to Meetings</button>
        </div>
      </div>
    );
  }

  const isVideoMeeting = meeting ? meeting.callType === 'video' : true;
  const peerEntries = Object.entries(peers);
  const status = !socketUp ? 'Reconnecting…' : joined ? 'Connected' : 'Connecting…';

  return (
    <div className="meeting-room">
      <div className="meeting-room-header">
        <strong>{meeting?.title || 'Meeting'}</strong>
        <div className="header-meta">
          <span className="meeting-pill">{peerEntries.length + 1} in call</span>
          <span className={`meeting-pill ${socketUp && joined ? 'ok' : ''}`}><span className="live-dot" />{status}</span>
        </div>
      </div>

      {notice && <div className="meeting-notice">{notice}</div>}

      <div className="meeting-grid">
        <MediaTile
          isLocal
          stream={localStream}
          name="You"
          isVideoMeeting={isVideoMeeting}
          audioMuted={audioMuted}
          videoOff={videoOff}
        />
        {peerEntries.map(([userId, p]) => (
          <MediaTile
            key={userId}
            stream={p.stream}
            name={p.name}
            isVideoMeeting={isVideoMeeting}
            audioMuted={p.audioMuted}
            videoOff={p.videoOff}
          />
        ))}
      </div>

      <div className="meeting-controls">
        <button
          type="button"
          className={`meeting-control-btn ${audioMuted ? 'muted' : ''}`}
          onClick={toggleAudio}
          disabled={!hasAudio}
          title={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
          aria-label={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {audioMuted ? <MicOffIcon /> : <MicIcon />}
        </button>
        {isVideoMeeting && (
          <button
            type="button"
            className={`meeting-control-btn ${videoOff ? 'muted' : ''}`}
            onClick={toggleVideo}
            disabled={!hasVideo}
            title={videoOff ? 'Turn camera on' : 'Turn camera off'}
            aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'}
          >
            {videoOff ? <VideoOffIcon /> : <VideoIcon />}
          </button>
        )}
        <button type="button" className="meeting-pill-btn" onClick={() => leaveRef.current()} aria-label="Leave meeting">
          <LeaveIcon /> Leave
        </button>
        {meeting?.isOwner && (
          <button type="button" className="meeting-pill-btn ghost" onClick={endForEveryone} disabled={ending}>
            {ending ? 'Ending…' : 'End for everyone'}
          </button>
        )}
      </div>
    </div>
  );
}
