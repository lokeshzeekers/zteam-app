import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function MeetingRoom() {
  const { id } = useParams();
  const meetingId = Number(id);
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState(null);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [peers, setPeers] = useState({}); // userId -> { name, audioMuted, videoOff }

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcsRef = useRef({}); // userId -> RTCPeerConnection
  const nameMapRef = useRef({}); // userId -> name (from meeting participant list)
  const videoTilesRef = useRef({}); // userId -> <video> element

  const setPeer = useCallback((userId, patch) => {
    setPeers((p) => ({ ...p, [userId]: { ...(p[userId] || { name: nameMapRef.current[userId] || 'Member' }), ...patch } }));
  }, []);

  function makePeerConnection(otherId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => {
      if (e.candidate) getSocket().emit('meeting-webrtc-ice-candidate', { meetingId, to: otherId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      const el = videoTilesRef.current[otherId];
      if (el) el.srcObject = e.streams[0];
    };
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current));
    pcsRef.current[otherId] = pc;
    return pc;
  }

  async function connectToExistingPeer(otherId) {
    const pc = makePeerConnection(otherId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    getSocket().emit('meeting-webrtc-offer', { meetingId, to: otherId, offer });
  }

  useEffect(() => {
    let cancelled = false;

    async function join() {
      try {
        const { data } = await api.get('/api/meetings');
        const found = data.meetings.find((m) => m.id === meetingId);
        if (found) {
          setMeeting(found);
          found.participants.forEach((p) => { nameMapRef.current[p.id] = p.name; });
        }

        const wantsVideo = found ? found.callType === 'video' : true;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantsVideo });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const socket = getSocket();
        socket.emit('meeting-join', { meetingId }, async (ack) => {
          if (cancelled) return;
          if (ack?.error) { setError(ack.error); return; }
          setJoined(true);
          for (const otherId of ack.existingPeers || []) {
            setPeer(otherId, {});
            await connectToExistingPeer(otherId);
          }
        });
      } catch (err) {
        if (!cancelled) setError(err?.message?.includes('Permission') ? 'Camera/microphone permission was denied.' : (err?.response?.data?.error || 'Could not join the meeting'));
      }
    }
    join();

    const socket = getSocket();
    const onPeerJoined = ({ userId, name }) => {
      nameMapRef.current[userId] = name;
      setPeer(userId, { name });
      // The new joiner will send us an offer; we just wait and answer.
    };
    const onOffer = async ({ from, offer }) => {
      let pc = pcsRef.current[from];
      if (!pc) pc = makePeerConnection(from);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      getSocket().emit('meeting-webrtc-answer', { meetingId, to: from, answer });
      setPeer(from, {});
    };
    const onAnswer = async ({ from, answer }) => {
      await pcsRef.current[from]?.setRemoteDescription(answer);
    };
    const onIce = async ({ from, candidate }) => {
      try { await pcsRef.current[from]?.addIceCandidate(candidate); } catch (e) { /* ignore */ }
    };
    const onPeerLeft = ({ userId }) => {
      pcsRef.current[userId]?.close();
      delete pcsRef.current[userId];
      setPeers((p) => { const next = { ...p }; delete next[userId]; return next; });
    };
    const onMuteUpdate = ({ userId, audioMuted: am, videoMuted: vm }) => {
      setPeer(userId, { audioMuted: am, videoOff: vm });
    };

    socket.on('meeting-peer-joined', onPeerJoined);
    socket.on('meeting-webrtc-offer', onOffer);
    socket.on('meeting-webrtc-answer', onAnswer);
    socket.on('meeting-webrtc-ice-candidate', onIce);
    socket.on('meeting-peer-left', onPeerLeft);
    socket.on('meeting-mute-update', onMuteUpdate);

    return () => {
      cancelled = true;
      socket.off('meeting-peer-joined', onPeerJoined);
      socket.off('meeting-webrtc-offer', onOffer);
      socket.off('meeting-webrtc-answer', onAnswer);
      socket.off('meeting-webrtc-ice-candidate', onIce);
      socket.off('meeting-peer-left', onPeerLeft);
      socket.off('meeting-mute-update', onMuteUpdate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  function leaveMeeting() {
    getSocket()?.emit('meeting-leave', { meetingId });
    Object.values(pcsRef.current).forEach((pc) => pc.close());
    pcsRef.current = {};
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    navigate('/meetings');
  }

  function toggleAudio() {
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setAudioMuted(!track.enabled);
    getSocket().emit('meeting-mute-update', { meetingId, audioMuted: !track.enabled, videoMuted: videoOff });
  }

  function toggleVideo() {
    const track = localStreamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setVideoOff(!track.enabled);
    getSocket().emit('meeting-mute-update', { meetingId, audioMuted, videoMuted: !track.enabled });
  }

  if (error) {
    return (
      <div className="panel">
        <p className="auth-error">{error}</p>
        <button onClick={() => navigate('/meetings')}>Back to Meetings</button>
      </div>
    );
  }

  const isVideoMeeting = meeting ? meeting.callType === 'video' : true;
  const peerEntries = Object.entries(peers);

  return (
    <div className="meeting-room">
      <div className="meeting-room-header">
        <strong>{meeting?.title || 'Meeting'}</strong>
        <span className="muted small">{joined ? 'Connected' : 'Connecting...'}</span>
      </div>

      <div className="meeting-grid">
        <div className="meeting-tile">
          {isVideoMeeting ? (
            <video ref={localVideoRef} autoPlay muted playsInline className={videoOff ? 'video-off' : ''} />
          ) : (
            <div className="meeting-audio-tile">🎙️</div>
          )}
          <div className="meeting-tile-label">You {audioMuted && '🔇'}</div>
        </div>

        {peerEntries.map(([userId, p]) => (
          <div className="meeting-tile" key={userId}>
            {isVideoMeeting ? (
              <video ref={(el) => { if (el) videoTilesRef.current[userId] = el; }} autoPlay playsInline className={p.videoOff ? 'video-off' : ''} />
            ) : (
              <div className="meeting-audio-tile">🎙️</div>
            )}
            <div className="meeting-tile-label">{p.name} {p.audioMuted && '🔇'}</div>
          </div>
        ))}
      </div>

      <div className="meeting-controls">
        <button className={`meeting-control-btn ${audioMuted ? 'muted' : ''}`} onClick={toggleAudio} aria-label={audioMuted ? 'Unmute microphone' : 'Mute microphone'}>
          {audioMuted ? '🔇' : '🎤'}
        </button>
        {isVideoMeeting && (
          <button className={`meeting-control-btn ${videoOff ? 'muted' : ''}`} onClick={toggleVideo} aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'}>
            {videoOff ? '📷' : '🎥'}
          </button>
        )}
        <button className="meeting-control-btn end-call" onClick={leaveMeeting} aria-label="Leave meeting">📞</button>
      </div>
    </div>
  );
}
