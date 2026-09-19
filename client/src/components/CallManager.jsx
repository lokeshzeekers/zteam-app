import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../socket';
import { notifyDesktop, flashTaskbar, clearFlash, playPing } from '../notify';

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function CallManager() {
  const [incoming, setIncoming] = useState(null); // { callerId, callerName, callType }
  const [activeCall, setActiveCall] = useState(null); // { withId, callType, status: connecting|active }
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onIncoming = ({ callerId, callerName, callType }) => {
      setIncoming({ callerId, callerName, callType });
      notifyDesktop({ title: `Incoming ${callType} call`, body: `${callerName} is calling you` });
      flashTaskbar();
      playPing();
    };
    const onAccepted = async () => {
      setActiveCall((c) => c && { ...c, status: 'active' });
      await createOfferAndSend();
    };
    const onRejected = () => { teardown(); };
    const onEnded = () => { teardown(); };
    const onUnavailable = () => { alert('User is offline'); setActiveCall(null); };

    const onOffer = async ({ from, offer }) => {
      await ensurePeerConnection(from);
      await pcRef.current.setRemoteDescription(offer);
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('webrtc-answer', { to: from, answer });
    };
    const onAnswer = async ({ answer }) => {
      await pcRef.current?.setRemoteDescription(answer);
    };
    const onIce = async ({ candidate }) => {
      try { await pcRef.current?.addIceCandidate(candidate); } catch (e) { /* ignore */ }
    };

    socket.on('incoming-call', onIncoming);
    socket.on('call-accepted', onAccepted);
    socket.on('call-rejected', onRejected);
    socket.on('call-ended', onEnded);
    socket.on('call-unavailable', onUnavailable);
    socket.on('webrtc-offer', onOffer);
    socket.on('webrtc-answer', onAnswer);
    socket.on('webrtc-ice-candidate', onIce);

    return () => {
      socket.off('incoming-call', onIncoming);
      socket.off('call-accepted', onAccepted);
      socket.off('call-rejected', onRejected);
      socket.off('call-ended', onEnded);
      socket.off('call-unavailable', onUnavailable);
      socket.off('webrtc-offer', onOffer);
      socket.off('webrtc-answer', onAnswer);
      socket.off('webrtc-ice-candidate', onIce);
    };
  }, [activeCall?.withId]);

  // Notifications for new chat messages (global, so it works from any page)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMsg = ({ message }) => {
      notifyDesktop({ title: 'New message', body: message.type === 'file' ? 'Sent a file' : message.content });
      flashTaskbar();
      playPing();
    };
    const onGroupMsg = ({ message }) => {
      notifyDesktop({ title: 'New group message', body: message.type === 'file' ? 'Sent a file' : message.content });
      flashTaskbar();
      playPing();
    };
    const onMeetingInvite = ({ meeting, from }) => {
      notifyDesktop({ title: 'Meeting invite', body: `${from?.name || 'Someone'} invited you to "${meeting.title}"` });
      flashTaskbar();
      playPing();
    };
    const onMeetingStarting = ({ meeting, from }) => {
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

  async function ensurePeerConnection(otherId) {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pc.onicecandidate = (e) => {
      if (e.candidate) getSocket().emit('webrtc-ice-candidate', { to: otherId, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true, video: activeCall?.callType === 'video' || incoming?.callType === 'video',
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pcRef.current = pc;
    return pc;
  }

  async function createOfferAndSend() {
    const otherId = activeCall.withId;
    const pc = await ensurePeerConnection(otherId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    getSocket().emit('webrtc-offer', { to: otherId, offer });
  }

  function startCall(calleeId, callType) {
    setActiveCall({ withId: calleeId, callType, status: 'connecting' });
    getSocket().emit('call-request', { calleeId, callType });
  }

  async function acceptIncoming() {
    const { callerId, callType } = incoming;
    setActiveCall({ withId: callerId, callType, status: 'active' });
    setIncoming(null);
    clearFlash();
    getSocket().emit('call-accept', { callerId });
  }

  function rejectIncoming() {
    getSocket().emit('call-reject', { callerId: incoming.callerId });
    setIncoming(null);
    clearFlash();
  }

  function endCall() {
    if (activeCall) getSocket().emit('call-end', { otherUserId: activeCall.withId });
    teardown();
  }

  function teardown() {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setActiveCall(null);
  }

  // expose startCall to window so ChatWindow (a sibling route) can trigger it
  useEffect(() => { window.__zteamStartCall = startCall; }, []);

  return (
    <>
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
            <div className="call-status">{activeCall.status === 'connecting' ? 'Calling...' : 'On call'}</div>
            {activeCall.callType === 'video' && (
              <div className="video-grid">
                <video ref={localVideoRef} autoPlay muted playsInline />
                <video ref={remoteVideoRef} autoPlay playsInline />
              </div>
            )}
            {activeCall.callType === 'audio' && <audio ref={remoteVideoRef} autoPlay />}
            <button className="btn-reject" onClick={endCall}>End Call</button>
          </div>
        </div>
      )}
    </>
  );
}
