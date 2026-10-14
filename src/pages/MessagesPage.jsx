import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MessageCircleMore, Search, Send } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import './MessagesPage.css'

function formatMessageTime(value) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatListTime(value) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  const isToday = date.toDateString() === today.toDateString()
  return new Intl.DateTimeFormat('en-IN', isToday ? { timeStyle: 'short' } : { day: 'numeric', month: 'short' }).format(date)
}

function initialsFor(name) {
  return (name || 'RentMate member').trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase()
}
function friendlyError(error) {
  if (error?.code === '42P01' || error?.code === '42703' || error?.code === '42883' || error?.code === 'PGRST202') {
    return 'Chat is not set up yet. Run chat_setup.sql in your Supabase SQL Editor, then reload.'
  }
  if (error?.code === '42501') return 'You do not have access to this conversation.'
  return error?.message || 'We could not load your messages. Please try again.'
}

export default function MessagesPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('conversation')
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [conversationLoading, setConversationLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [conversationError, setConversationError] = useState('')
  const [messagesError, setMessagesError] = useState('')
  const [draft, setDraft] = useState('')
  const [conversationSearch, setConversationSearch] = useState('')
  const [sending, setSending] = useState(false)
  const listEndRef = useRef(null)
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) || null
  const filteredConversations = useMemo(() => {
    const query = conversationSearch.trim().toLocaleLowerCase()
    if (!query) return conversations
    return conversations.filter((conversation) => [conversation.otherName, conversation.items?.title, conversation.latestMessage?.body]
      .some((value) => value?.toLocaleLowerCase().includes(query)))
  }, [conversations, conversationSearch])

  const loadConversations = useCallback(async () => {
    if (!supabase || !user?.id) return []
    const { data: rows, error } = await supabase.from('conversations')
      .select('id, item_id, renter_id, owner_id, created_at, items(title, image_url)')
      .order('created_at', { ascending: false })
    if (error) throw error
    const entries = rows || []
    if (!entries.length) {
      setConversations([])
      return []
    }

    const participantIds = [...new Set(entries.flatMap((entry) => [entry.renter_id, entry.owner_id]))]
    const [{ data: profiles, error: profilesError }, lastMessageResults] = await Promise.all([
      supabase.from('profiles').select('id, full_name').in('id', participantIds),
      Promise.all(entries.map((entry) => supabase.from('messages')
        .select('body, created_at')
        .eq('conversation_id', entry.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle())),
    ])
    if (profilesError) throw profilesError
    const profileNames = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile.full_name?.trim() || 'RentMate member']))
    const latestById = new Map()
    entries.forEach((entry, index) => {
      const result = lastMessageResults[index]
      if (result.error) throw result.error
      latestById.set(entry.id, result.data || null)
    })
    const mapped = entries.map((entry) => {
      const otherId = entry.owner_id === user.id ? entry.renter_id : entry.owner_id
      return {
        ...entry,
        otherName: profileNames[otherId] || 'RentMate member',
        latestMessage: latestById.get(entry.id),
      }
    })
    setConversations(mapped)
    return mapped
  }, [user?.id])

  const loadMessages = useCallback(async (conversationId) => {
    if (!supabase || !conversationId) return []
    const { data, error } = await supabase.from('messages')
      .select('id, conversation_id, sender_id, body, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (error) throw error
    setMessages(data || [])
    return data || []
  }, [])

  useEffect(() => {
    let active = true
    setConversationLoading(true)
    setConversationError('')
    loadConversations().catch((error) => { if (active) setConversationError(friendlyError(error)) })
      .finally(() => { if (active) setConversationLoading(false) })
    return () => { active = false }
  }, [loadConversations])

  useEffect(() => {
    if (!selectedId || !conversations.some((entry) => entry.id === selectedId)) {
      setMessages([])
      return undefined
    }
    let active = true
    setMessagesLoading(true)
    setMessagesError('')
    loadMessages(selectedId).catch((error) => { if (active) setMessagesError(friendlyError(error)) })
      .finally(() => { if (active) setMessagesLoading(false) })
    return () => { active = false }
  }, [selectedId, conversations, loadMessages])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    const channel = supabase.channel(`chat-updates:${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, () => {
        loadConversations().catch((error) => setConversationError(friendlyError(error)))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const message = payload.new
        if (message.conversation_id === selectedId) {
          setMessages((current) => current.some((entry) => entry.id === message.id) ? current : [...current, message])
        }
        loadConversations().catch((error) => setConversationError(friendlyError(error)))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user?.id, selectedId, loadConversations])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const selectedIsValid = useMemo(() => Boolean(selectedId && conversations.some((entry) => entry.id === selectedId)), [selectedId, conversations])

  async function sendMessage(event) {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || !selectedConversation || sending || !supabase) return
    setSending(true)
    setMessagesError('')
    try {
      const { data, error } = await supabase.from('messages').insert({ conversation_id: selectedConversation.id, body })
        .select('id, conversation_id, sender_id, body, created_at').single()
      if (error) throw error
      setMessages((current) => current.some((entry) => entry.id === data.id) ? current : [...current, data])
      setDraft('')
      loadConversations().catch((loadError) => setConversationError(friendlyError(loadError)))
    } catch (error) {
      setMessagesError(friendlyError(error))
    } finally {
      setSending(false)
    }
  }

  function selectConversation(conversationId) {
    setSearchParams({ conversation: conversationId })
    setMessagesError('')
  }

  function backToList() {
    setSearchParams({})
  }

  return <main className="messages-page">
    <div className="messages-container">
      <div className="messages-layout">
        <aside className={`messages-sidebar${selectedId ? ' is-mobile-hidden' : ''}`} aria-label="Conversations">
          <div className="messages-sidebar-top">
            <div className="messages-sidebar-heading"><h1>Messages</h1><span>{conversations.length}</span></div>
            <label className="messages-search"><Search size={17} aria-hidden="true" /><span className="visually-hidden">Search conversations</span><input type="search" value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search people, items, or messages" /></label>
          </div>
          {conversationError && <p className="messages-error" role="alert">{conversationError}</p>}
          {conversationLoading ? <div className="messages-list-loading" role="status">Loading conversations…</div>
            : !conversations.length ? <div className="messages-list-empty"><span aria-hidden="true">r.</span><p>No conversations yet.</p><small>Open an item and choose Message owner to start one.</small><Link to="/">Browse items</Link></div>
              : !filteredConversations.length ? <p className="messages-search-empty">No conversations match your search.</p>
              : <ul className="messages-conversation-list">{filteredConversations.map((conversation) => <li key={conversation.id}>
                <button type="button" className={`messages-conversation${selectedId === conversation.id ? ' is-selected' : ''}`} onClick={() => selectConversation(conversation.id)} aria-current={selectedId === conversation.id ? 'page' : undefined}>
                  {conversation.items?.image_url ? <img className="messages-item-thumb" src={conversation.items.image_url} alt="" /> : <span className="messages-item-placeholder" aria-hidden="true">r.</span>}<span className="messages-person-avatar" aria-hidden="true">{initialsFor(conversation.otherName)}</span>
                  <span className="messages-conversation-copy"><strong>{conversation.otherName}</strong><small>{conversation.items?.title || 'Item listing'}</small><span>{conversation.latestMessage?.body || 'Start the conversation'}</span></span>
                  {conversation.latestMessage?.created_at && <time dateTime={conversation.latestMessage.created_at}>{formatListTime(conversation.latestMessage.created_at)}</time>}
                </button>
              </li>)}</ul>}
        </aside>

        <section className={`messages-chat${!selectedId ? ' is-mobile-hidden' : ''}`} aria-label="Chat">
          {!selectedIsValid ? <div className="messages-chat-empty">{selectedId && <button type="button" className="messages-back-button" onClick={backToList}><ArrowLeft size={16} aria-hidden="true" /><span>Conversations</span></button>}<span className="details-section-kicker">YOUR INBOX</span><h2>{selectedId && !conversationLoading ? 'Conversation unavailable' : 'Choose a conversation'}</h2><p>{conversationError || (selectedId && !conversationLoading ? 'This conversation may have been removed or you may not have access.' : 'Your messages with an item owner or renter will appear here.')}</p></div>
            : <>
              <header className="messages-chat-header">
                <button type="button" className="messages-back-button" onClick={backToList}><ArrowLeft size={16} aria-hidden="true" /><span>Conversations</span></button>
                <div className="messages-chat-person">
                  <span className="messages-person-avatar messages-chat-avatar" aria-hidden="true">{initialsFor(selectedConversation?.otherName)}</span>
                  <div><strong>{selectedConversation?.otherName}</strong><small>{selectedConversation?.items?.title || 'Item listing'}</small></div>
                </div>
                {selectedConversation?.items?.image_url && <img className="messages-chat-item-thumb" src={selectedConversation.items.image_url} alt="" />}
                <Link to={`/items/${selectedConversation.item_id}`}>View item</Link>
              </header>
              {conversationError && <p className="messages-error" role="alert">{conversationError}</p>}
              <div className="messages-history" aria-live="polite">
                {messagesLoading ? <p className="messages-history-state" role="status">Loading messages…</p>
                  : !messages.length ? <div className="messages-first-note"><span aria-hidden="true">✦</span><p>This is the beginning of your conversation about <strong>{selectedConversation?.items?.title || 'this item'}</strong>.</p></div>
                    : messages.map((message) => <article key={message.id} className={`message-bubble${message.sender_id === user.id ? ' is-mine' : ''}`}><p>{message.body}</p><time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time></article>)}
                <div ref={listEndRef} />
              </div>
              {messagesError && <p className="messages-error messages-send-error" role="alert">{messagesError}</p>}
              <form className="messages-composer" onSubmit={sendMessage}>
                <label className="visually-hidden" htmlFor="message-draft">Write a message</label>
                <textarea id="message-draft" value={draft} maxLength={4000} rows={1} placeholder="Write a message…" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) sendMessage(event) }} disabled={sending} />
                <button type="submit" disabled={!draft.trim() || sending} aria-label="Send message"><Send size={16} aria-hidden="true" /><span>{sending ? 'Sending…' : 'Send'}</span></button>
              </form>
              <p className="messages-composer-hint">Press Enter to send · Shift + Enter for a new line</p>
            </>}
        </section>
      </div>
    </div>
  </main>
}
