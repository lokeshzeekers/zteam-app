import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket';
import { notifyDesktop, closeNotification, flashTaskbar, clearFlash, playPing } from '../notify';
import { MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, LeaveIcon } from './CallIcons';
import { useAuth } from '../context/AuthContext';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const callTag = (callerId) => `zteam-call-${callerId}`;

// Ask for mic (+ camera for video calls). A missing camera downgrades a video
// call to audio instead of failing; a missing/blocked mic is reported clearly.
async function getMedia(callType) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Your browser blocks the microphone on this address. Open Zteam over HTTPS (or localhost) to make calls.');
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio: true, video: callType === 'video' }), callType };
  } catch (err) {
    if (callType === 'video' && err?.name !== 'NotAllowedError') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      return { stream, callType: 'audio' };
    }
    if (err?.name === 'NotAllowedError') throw new Error('Microphone/camera permission was denied. Allow access in your browser and try again.');
    if (err?.name === 'NotFoundError') throw new Error('No microphone was found on this device.');
    throw new Error('Could not access your microphone/camera.');
  }
}

export default function CallManager() {
  const { user } = useAuth();
  const meRef = useRef(user?.id);
  meRef.current = user?.id;
  const [incoming, setIncoming] = useState(null); // { callerId, callerName, callType }
  const [activeCall, setActiveCall] = useState(null); // { withId, callType, status: calling|connecting|active }
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [toast, setToast] = useState('');

  // Refs mirror the state so socket handlers (registered once) always see the
  // CURRENT call - previously they saw whatever the call was when they were created.
  const incomingRef = useRef(null);
  const activeRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingIceRef = useRef([]);
  const localVideoRef = useRef(null);
  const remoteMediaRef = useRef(null);
  const toastTimer = useRef(null);

  const setIncomingBoth = (v) => { incomingRef.current = v; setIncoming(v); };
  const setActiveBoth = (v) => { activeRef.current = v; setActiveCall(v); };
  const patchActive = (patch) => { if (activeRef.current) setActiveBoth({ ...activeRef.current, ...patch }); };

  function showToast(message) {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }

  function dismissIncoming(callerId) {
    setIncomingBoth(null);
    closeNotification(callTag(callerId));
    clearFlash();
  }

  function teardown() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    setActiveBoth(null);
    setAudioMuted(false);
    setVideoOff(false);
  }

  function createPeerConnection(otherId) {
    pcRef.current?.close();
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pendingIceRef.current = [];
    pc.onicecandidate = (e) => {
      if (e.candidate) getSocket()?.emit('webrtc-ice-candidate', { to: otherId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      remoteStreamRef.current = e.streams[0] || new MediaStream([e.track]);
      const el = remoteMediaRef.current;
      if (el) { el.srcObject = remoteStreamRef.current; el.play?.().catch(() => {}); }
    };
    pc.onconnectionstatechange = () => {
      if (pc !== pcRef.current) return;
      if (pc.connectionState === 'connected') patchActive({ status: 'active' });
      if (pc.connectionState === 'failed') {
        showToast('The call connection was lost.');
        getSocket()?.emit('call-end', { otherUserId: otherId });
        teardown();
      }
    };
    const stream = localStreamRef.current;
    stream?.getTracks().forEach((t) => pc.addTrack(t, stream));
    pcRef.current = pc;
    return pc;
  }

  async function flushIce(pc) {
    const queued = pendingIceRef.current;
    pendingIceRef.current = [];
    for (const c of queued) { try { await pc.addIceCandidate(c); } catch (e) { /* stale */ } }
  }

  // ---------- Socket events ----------
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const onIncoming = ({ callerId, callerName, callType }) => {
      if (activeRef.current) return; // already on a call (the server also blocks this)
      setIncomingBoth({ callerId, callerName, callType });
      notifyDesktop({ title: `Incoming ${callType} call`, body: `${callerName} is calling you`, tag: callTag(callerId) });
      flashTaskbar();
      playPing();
    };

    // The other side picked up: start the media connection.
    const onAccepted = async ({ by }) => {
      const c = activeRef.current;
      if (!c || c.withId !== by || c.status !== 'calling') return; // stale / not our call
      patchActive({ status: 'connecting' });
      try {
        const pc = createPeerConnection(by);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        getSocket()?.emit('webrtc-offer', { to: by, offer });
      } catch (err) {
        console.error('Could not start call', err);
        getSocket()?.emit('call-end', { otherUserId: by });
        teardown();
        showToast('Could not start the call.');
      }
    };

    const onRejected = ({ by }) => {
      if (activeRef.current?.withId === by) { teardown(); showToast('Call declined.'); }
    };

    // The call stopped: caller hung up while ringing, nobody answered in time,
    // it was answered on another device, or the other person left mid-call.
    const onEnded = ({ by, reason }) => {
      if (incomingRef.current?.callerId === by) {
        const name = incomingRef.current.callerName;
        dismissIncoming(by);
        if (reason === 'missed') showToast(`Missed call from ${name}.`);
      }
      if (activeRef.current?.withId === by) {
        teardown();
        if (reason === 'no-answer') showToast('No answer.');
        else if (reason === 'disconnected') showToast('The other person lost connection.');
      }
    };

    const onUnavailable = ({ reason }) => {
      teardown();
      showToast(reason === 'busy' ? 'That person is on another call.' : 'That person is offline.');
    };

    const onOffer = async ({ from, offer }) => {
      const c = activeRef.current;
      if (!c || c.withId !== from) return;
      try {
        const pc = createPeerConnection(from);
        await pc.setRemoteDescription(offer);
        await flushIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        getSocket()?.emit('webrtc-answer', { to: from, answer });
      } catch (err) {
        console.error('Could not answer call', err);
        getSocket()?.emit('call-end', { otherUserId: from });
        teardown();
        showToast('Could not connect the call.');
      }
    };
    const onAnswer = async ({ from, answer }) => {
      const pc = pcRef.current;
      if (!pc || activeRef.current?.withId !== from) return;
      try { await pc.setRemoteDescription(answer); await flushIce(pc); } catch (err) { console.error(err); }
    };
    // Candidates can arrive before we're ready for them - hold them until we are.
    const onIce = async ({ from, candidate }) => {
      if (activeRef.current?.withId !== from) return;
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) { pendingIceRef.current.push(candidate); return; }
      try { await pc.addIceCandidate(candidate); } catch (e) { /* ignore */ }
    };

    // Lost the server connection: any ringing / live call is over.
    const onDisconnect = () => {
      if (incomingRef.current) dismissIncoming(incomingRef.current.callerId);
      if (activeRef.current) { teardown(); showToast('Connection lost — the call ended.'); }
    };

    socket.on('incoming-call', onIncoming);
    socket.on('call-accepted', onAccepted);
    socket.on('call-rejected', onRejected);
    socket.on('call-ended', onEnded);
    socket.on('call-unavailable', onUnavailable);
    socket.on('webrtc-offer', onOffer);
    socket.on('webrtc-answer', onAnswer);
    socket.on('webrtc-ice-candidate', onIce);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('incoming-call', onIncoming);
      socket.off('call-accepted', onAccepted);
      socket.off('call-rejected', onRejected);
      socket.off('call-ended', onEnded);
      socket.off('call-unavailable', onUnavailable);
      socket.off('webrtc-offer', onOffer);
      socket.off('webrtc-answer', onAnswer);
      socket.off('webrtc-ice-candidate', onIce);
      socket.off('disconnect', onDisconnect);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notifications for new chat messages (global, so it works from any page)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;
    const onMsg = ({ message }) => {
      notifyDesktop({ title: 'New message', body: message.type === 'file' ? 'Sent a file' : message.content });
      flashTaskbar();
      playPing();
    };
    const onGroupMsg = ({ message }) => {
      if (message.senderId === meRef.current) return; // your own message (your other devices receive it too)
      notifyDesktop({ title: 'New group message', body: message.type === 'file' ? 'Sent a file' : message.content });
      flashTaskbar();
      playPing();
    };
    const onMeetingInvite = ({ meeting, from }) => {
      notifyDesktop({ title: 'Meeting invite', body: `${from?.name || 'Someone'} invited you to "${meeting.title}"` });
      flashTaskbar();
      playPing();
    };
    const onMeetingStarting = ({ meeting }) => {
      notifyDesktop({ title: 'Meeting starting now', body: `"${meeting.title}" is starting — join now` });
      flashTaskbar();
      playPing();
    };
    const onMeetingCancelled = ({ title }) => {
      notifyDesktop({ title: 'Meeting cancelled', body: `"${title}" was cancelled` });
    };
    socket.on('new-message', onMsg);
    socket.on('new-group-message', onGroupMsg);
    socket.on('meeting-invite', onMeetingInvite);
    socket.on('meeting-starting', onMeetingStarting);
    socket.on('meeting-cancelled', onMeetingCancelled);
    return () => {
      socket.off('new-message', onMsg);
      socket.off('new-group-message', onGroupMsg);
      socket.off('meeting-invite', onMeetingInvite);
      socket.off('meeting-starting', onMeetingStarting);
      socket.off('meeting-cancelled', onMeetingCancelled);
    };
  }, []);

  useEffect(() => {
    function onFocus() { clearFlash(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // ---------- Actions ----------
  async function startCall(calleeId, callType) {
    if (activeRef.current || incomingRef.current) { showToast('Finish your current call first.'); return; }
    let media;
    try { media = await getMedia(callType); } catch (err) { showToast(err.message); return; }
    localStreamRef.current = media.stream;
    setActiveBoth({ withId: calleeId, callType: media.callType, status: 'calling' });
    getSocket().emit('call-request', { calleeId, callType: media.callType });
  }

  async function acceptIncoming() {
    const inc = incomingRef.current;
    if (!inc) return;
    let media;
    try { media = await getMedia(inc.callType); }
    catch (err) {
      getSocket()?.emit('call-reject', { callerId: inc.callerId });
      dismissIncoming(inc.callerId);
      showToast(err.message);
      return;
    }
    // The caller may have hung up while the permission prompt was open.
    if (incomingRef.current?.callerId !== inc.callerId) {
      media.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    localStreamRef.current = media.stream;
    setActiveBoth({ withId: inc.callerId, callType: inc.callType, status: 'connecting' });
    dismissIncoming(inc.callerId);
    getSocket().emit('call-accept', { callerId: inc.callerId });
  }

  function rejectIncoming() {
    const inc = incomingRef.current;
    if (!inc) return;
    getSocket()?.emit('call-reject', { callerId: inc.callerId });
    dismissIncoming(inc.callerId);
  }

  function endCall() {
    const c = activeRef.current;
    if (c) getSocket()?.emit('call-end', { otherUserId: c.withId });
    teardown();
  }

  function toggleAudio() {
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setAudioMuted(!track.enabled);
  }

  function toggleVideo() {
    const track = localStreamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setVideoOff(!track.enabled);
  }

  // expose startCall to window so ChatWindow (a sibling route) can trigger it
  useEffect(() => { window.__zteamStartCall = startCall; }, []);

  // Attach streams whenever the <video>/<audio> element (re)mounts, so it makes
  // no difference whether the media arrived before or after the element rendered.
  const bindLocal = (el) => {
    localVideoRef.current = el;
    if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) el.srcObject = localStreamRef.current;
  };
  const bindRemote = (el) => {
    remoteMediaRef.current = el;
    if (el && remoteStreamRef.current && el.srcObject !== remoteStreamRef.current) {
      el.srcObject = remoteStreamRef.current;
      el.play?.().catch(() => {});
    }
  };

  const statusLabel = { calling: 'Calling…', connecting: 'Connecting…', active: 'On call' };

  return (
    <>
      {toast && <div className="call-toast" role="status">{toast}</div>}

      {incoming && !activeCall && (
        <div className="call-banner">
          <span>{incoming.callType === 'video' ? '🎥' : '📞'} {incoming.callerName} is calling...</span>
          <div>
            <button className="btn-accept" onClick={acceptIncoming}>Accept</button>
            <button className="btn-reject" onClick={rejectIncoming}>Decline</button>
          </div>
        </div>
      )}
      {activeCall && (
        <div className="call-modal">
          <div className="call-modal-inner">
            <div className="call-status">{statusLabel[activeCall.status] || 'On call'}</div>
            {activeCall.callType === 'video' ? (
              <div className="meeting-grid call-video-grid">
                <div className="meeting-tile">
                  <video ref={bindLocal} autoPlay muted playsInline className={`mirrored ${videoOff ? 'video-hidden' : ''}`} />
                  <div className="meeting-tile-label">You {audioMuted && <MicOffIcon />}</div>
                </div>
                <div className="meeting-tile">
                  <video ref={bindRemote} autoPlay playsInline />
                </div>
              </div>
            ) : (
              <audio ref={bindRemote} autoPlay />
            )}

            {/* Footer control bar — same layout/icons as the group meeting room */}
            <div className="meeting-controls">
              <button
                type="button"
                className={`meeting-control-btn ${audioMuted ? 'muted' : ''}`}
                onClick={toggleAudio}
                title={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
                aria-label={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
              >
                {audioMuted ? <MicOffIcon /> : <MicIcon />}
              </button>
              {activeCall.callType === 'video' && (
                <button
                  type="button"
                  className={`meeting-control-btn ${videoOff ? 'muted' : ''}`}
                  onClick={toggleVideo}
                  title={videoOff ? 'Turn camera on' : 'Turn camera off'}
                  aria-label={videoOff ? 'Turn camera on' : 'Turn camera off'}
                >
                  {videoOff ? <VideoOffIcon /> : <VideoIcon />}
                </button>
              )}
              <button type="button" className="meeting-pill-btn" onClick={endCall} aria-label="End call">
                <LeaveIcon /> {activeCall.status === 'calling' ? 'Cancel' : 'End Call'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
