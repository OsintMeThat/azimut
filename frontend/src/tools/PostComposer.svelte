<script>
  import { onDestroy, tick, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { fetchAllEntities, lookupEntity, fetchDerivation } from '../lib/catalog.js';
  import { caseState, uiState, toast, reloadCase, prefs, updatesState } from '../lib/state.svelte.js';
  import { copyText } from '../lib/clipboard.js';
  import { templatesState, postDraftState } from '../lib/state.svelte.js';
  import { holdsUnsaved, onBackForward, settlePlace } from '../lib/backButton.js';
  import { createAutosave } from '../lib/autosave.svelte.js';
  import { createNote } from '../lib/notes.js';
  import { openGuide, openNotebook } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { proofCoordsText, proofSource } from '../lib/composer.js';
  import {
    isDefaultName, itemLabel, nextName, ownName, savedSlugs, savedTitles, slugify, specAttr, specPath,
  } from '../lib/naming.js';
  import { filingName, planProofHandoff, proofPosts } from './post/handoff.js';
  import { spanNote, startFields, startPost } from './post/start.js';
  import { timecode, usesSheet, videoSlides } from '../lib/videoThread.js';
  import { threadPostLabel, videoLayout, videoLink, videoPosts } from '../lib/videoPost.js';
  import { overWords, videoFits } from '../lib/videoLimits.js';
  import { videoName } from '../lib/proofScene.js';
  import { fileThreadSheet, makeRecapMap } from './post/threadSheet.js';
  import RecapMap from './post/RecapMap.svelte';
  import { BACKGROUND_NAMES, mapOptions, recapFit, recapPlaces } from '../lib/recapMap.js';
  import { defaultProofTemplate } from '../lib/proofTemplates.js';
  import { postLabel, THREAD_MIN } from './post/postHome.js';
  import { extensionWindowPutAway, putExtensionWindowAway } from './post/extensionWindow.js';
  import {
    buildTweet1 as buildTweet1Lines, DEFAULT_TWEET_BODY,
    extraPostTweetText, groupPostMedia, MAX_POST_MEDIA, mediaTweetText,
    applyPostTemplateStructure, newPostMediaTweet, proofSourceMediaPaths, withPostClip,
    normalizePostMediaPickerTarget, postMediaForType, renumberMediaTweetText, retargetMediaTweetText,
    normalizePostTarget, POST_TARGETS, postCharacterCount, postComposeUrl, postReportMarkdown,
    postTarget, templateUsesPostField, togglePostMedia, pointLines,
    handoffThread, postHandoffUrl, postDate,
    defaultPostTemplate, normalizePostKind, postKind, postStarters, normPostTemplate, VIDEO_THREAD_STARTERS,
    replyByDefault, replyIntentUrl, replyPostText, replyTarget, startMediaPlan,
    statedPostKind, templatesOfKind, videoTitle,
    postedAddress, postedDay, postedWhen, postFingerprint, postState,
  } from '../lib/post.js';
  import {
    extensionOutdated, extensionVersion, handOffPost, onPostHandoffReport, onPostLinkCaught,
  } from '../lib/extBridge.js';
  import { bidiSafe } from '../lib/bidi.js';
  import { mapLinks } from '../lib/maplinks.js';
  import { matchesQuery } from '../lib/mediaFilter.js';
  import Icon from '../components/Icon.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import BackButton from '../components/BackButton.svelte';
  import PostHome from './post/PostHome.svelte';
  import NewPostGallery from './post/NewPostGallery.svelte';
  import ExtensionWindow from './post/ExtensionWindow.svelte';
  import ReplyDialog from './post/ReplyDialog.svelte';
  import PostOpenList from './post/PostOpenList.svelte';
  import PostedControl from './post/PostedControl.svelte';
  import VideoPicker from './post/VideoPicker.svelte';
  import VideoThreadPanel from './post/VideoThreadPanel.svelte';
  import AltTextBox from './post/AltTextBox.svelte';
  import AltTexts from './post/AltTexts.svelte';
  import { altRecord, altSuggestion, readAltRecord, withAltTexts } from '../lib/postAlt.js';

  let coordsText = $state('');
  let geo = $state(null); // {lat, lon, dms, plus_code}
  // The same verified table Coords & Sky and the point menu open, labelled for a reader.
  const geoLinks = $derived(geo ? mapLinks(geo.lat, geo.lon) : []);
  let place = $state('');
  let placeLoading = $state(false);
  let description = $state('');
  let mention = $state(prefs.postMention);
  let source = $state('');
  /** The Source box grows with what it holds, up to four lines: a proof read from a
   *  thread carries an address per post, and one row would hide all but the first. */
  const sourceRows = $derived(Math.min(4, Math.max(1, source.split('\n').length)));
  // The date the proof states, as the post carries it (lib/post.postDate). Only a
  // template holding `#date` shows the field, so the classic thread never grows a
  // date line nobody asked for.
  let date = $state('');
  // Set when the attached proof was read and states no date, so the empty field
  // says why rather than looking forgotten.
  let proofUndated = $state(false);
  // A before and after with a side still `?` says which one under the field (`spanNote`).
  const dateNote = $derived(spanNote(date));
  // The credit line `#credits` prints: what a Compare or Map plate start hands over, as
  // the analyst leaves it. Shown, like the date, only when the layout holds its token.
  let credits = $state('');
  // The time the proof states in its video, as a post prints it (`[0:00–0:07]`,
  // lib/videoThread.js), for `#timecode`. A photo's proof and a proof about the whole
  // video state none, and the line drops. Its field shows once a proof gave one.
  let timecodeText = $state('');
  let timecodeKnown = $state(false);
  let proofPng = $state(null);
  let proofVer = $state(0); // cache-buster: bumped whenever proofPng is (re)assigned
  let tweet1 = $state('');
  let tweet1Edited = $state(false);
  let target = $state('x');
  const targetInfo = $derived(postTarget(target));

  // The active thread layout — a token body (lib/post.js). buildTweet1 fills the
  // tokens from the draft. A post template swaps this out; the default is the
  // classic GeoConfirmed thread.
  let body = $state(DEFAULT_TWEET_BODY);

  // Media tweet (tweet 2)
  let mediaEnabled = $state(true);
  let mediaType = $state('none'); // 'none' | 'video' | 'images'
  let mediaText = $state(''); // complete, editable tweet 2 text (prefix included)
  let mediaPaths = $state([]); // local media selected for tweet 2 (case-relative)

  // Extra context tweets (3, 4, …)
  let extraSeq = 0;
  let extraTweets = $state([]); // [{ id, text, mediaPaths, mediaType }]

  // What the post is made from (lib/post.js POST_KINDS). A Geolocation post is the
  // composer as it always was, its first post carrying the proof. Any other kind
  // carries its own pictures or video on its first post instead (`firstMedia`), and
  // shows only the fields its layout uses.
  let kind = $state('geolocation');
  const geolocation = $derived(kind === 'geolocation');
  let firstMedia = $state([]);
  let firstMediaType = $state('none'); // 'none' | 'video' | 'images'

  // A video thread: the placed proofs of one video as one thread (lib/videoThread.js,
  // lib/videoPost.js), null for any other kind. A draft keeps its video, its order, the
  // texts of its video post and of each place's post beside `body` (the recap), the post
  // that opens it (`first`), the template's closing posts (`extra`) and what it filed or
  // picked: the contact sheet, a clip in place of the whole video, or its link. Its
  // places (`slides`, `left`), the video's length, their addresses and how many places
  // a thread could not hold are read again.
  let thread = $state(null);
  let videoPickerOpen = $state(false);

  // Whether a post is open: a draft, a proof sent over, a start picked. Without one a
  // case that holds drafts or proofs shows the home instead of an empty composer.
  let postOpen = $state(false);

  // The case's drafts and proofs as their lists give them (`GET /drafts`, `GET /proofs`),
  // for the home and for what a proof rests on. Null while read; read again when the
  // case moves, while Post is the tool in front.
  let caseDrafts = $state(null);
  let caseProofs = $state(null);
  let listsFor = $state(null); // the case they were asked for
  let listsRun = 0;
  let listsAsked = ''; // what the last read was for, so one reason reads once
  // Each showing of the home counts, so it reads the lists once each time it is shown:
  // back from a post (whose link or name may have changed with no move of the case),
  // after a delete, and on coming back to Post. A mark from the home reads them itself.
  let homeShowing = 0;
  let wasIdle = false;
  $effect(() => {
    const id = caseState.current?.id;
    const rev = caseState.rev;
    if (uiState.tool !== 'post') {
      wasIdle = false;
      return;
    }
    // Read for the home while no post is open, and for a proof the list does not hold
    // yet (one just saved and sent over), never on each save of a post being written.
    const idle = !postOpen && !hasContent;
    if (idle && !wasIdle) homeShowing += 1;
    wasIdle = idle;
    const unknown = proofPng && !(caseProofs ?? []).some((row) => row.png === proofPng) ? proofPng : '';
    if (!id) {
      untrack(() => {
        caseDrafts = null;
        caseProofs = null;
        listsFor = null;
        listsAsked = '';
      });
      return;
    }
    if (!idle && !unknown) return;
    const reason = `${id}|${rev}|${idle ? `home ${homeShowing}` : unknown}`;
    untrack(() => {
      if (reason === listsAsked) return;
      listsAsked = reason;
      if (listsFor !== id) {
        caseDrafts = null;
        caseProofs = null;
      }
      listsFor = id;
      readLists(id);
    });
  });

  async function readLists(caseId) {
    const run = ++listsRun;
    const [drafts, proofs] = await Promise.all([
      api.get(`/api/cases/${caseId}/drafts`).catch(() => null),
      api.get(`/api/cases/${caseId}/proofs`).catch(() => null),
    ]);
    if (run !== listsRun || listsFor !== caseId) return;
    caseDrafts = Array.isArray(drafts) ? drafts : (caseDrafts ?? []);
    caseProofs = Array.isArray(proofs) ? proofs : (caseProofs ?? []);
  }

  // The home stands in for an empty composer once the case's lists are asked for, its
  // cards breathing while they come, and gives way to the composer it always opened on
  // when the case turns out to hold neither a draft nor a proof.
  const homeAvailable = $derived(
    !!caseState.current && listsFor === caseState.current.id
      && (caseDrafts === null || caseProofs === null || caseDrafts.length > 0 || caseProofs.length > 0)
  );

  // Draft persistence. A post saves itself, as Inspect's work does, once something is
  // typed, picked or attached: an untouched blank post files nothing. The name in the
  // header is the draft's filename. It is taken when the field is left (`postTitle`),
  // and renaming a saved draft moves its file (the backend does the move). `draftName`
  // is the slug it is bound to, or null before the first save. A post the analyst gave
  // no name files under a technical one, "Post 3", which the field never shows: it
  // stays empty, and the lists show the post's label (`postHome.postLabel`).
  let postName = $state(''); // the field: the analyst's name, '' for none
  let postTitle = $state(''); // the name it is saved under, the field's once left
  let draftName = $state(null);

  // Every draft already saved in this case: the slugs to catch a name already
  // taken, the names so a fresh draft reads apart from them.
  let draftEntities = $state([]);
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      draftEntities = [];
      return;
    }
    let live = true;
    fetchAllEntities(id, { types: ['post'] })
      .then((list) => {
        if (!live) return;
        draftEntities = list;
        // The name was assigned before the case's drafts were known. Renumber it
        // now rather than letting a fresh thread collide on its first save.
        if (!draftName && isDefaultName(postTitle, 'draft')) postTitle = freshPostName();
      })
      .catch(() => { if (live) draftEntities = []; });
    return () => { live = false; };
  });

  // Numbered past the drafts already in the case, so two never-renamed threads
  // file apart. Assigned on mount and on discard.
  const freshPostName = () => nextName('draft', savedTitles(draftEntities, 'draft'));
  // A name cleared: the technical one the post holds already, else a fresh one.
  const technicalPostName = () => (draftName && isDefaultName(draftName, 'draft') ? draftName : freshPostName());

  // Kept in step with deletes made anywhere else in the app: a draft deleted
  // from the sidebar must not be resurrected by the next Save under its old
  // name. The thread on screen stays — a post outlives its proof (ONTOLOGY §3),
  // it only loses the attachment.
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    const draft = draftName;
    const proof = proofPng;
    if (!id) return;
    let live = true;
    (async () => {
      if (draft) {
        const bound = await lookupEntity(id, specAttr('draft'), specPath('draft', draft));
        if (live && !bound && draftName === draft) {
          // what is on screen stays, as it is: an edit is what files it again
          draftName = null;
          writtenKey = null;
          blankKey = contentKey();
          autosave.cancel();
          toast('This post was deleted. An edit saves it again', 'warn');
        }
      }
      if (proof) {
        const bound = await lookupEntity(id, 'path', proof);
        if (live && !bound && proofPng === proof) {
          setProof(null);
          toast('The attached proof was deleted. The thread text is unchanged', 'warn');
        }
      }
    })();
    return () => {
      live = false;
    };
  });
  let reportModal = $state(null); // { title, folder }: Add to notes
  let postMenu = $state(null); // the header's ⋯, by the button that opened it
  let reportSaving = $state(false);
  let openList = $state(null); // list of saved drafts, null = closed

  // Media picker modal
  let pickerOpen = $state(false);
  let mediaLibrary = $state([]);
  let mediaPickerTarget = $state(null); // null = tweet 2; 'first' = post 1 of a non-geolocation; an id = a later media tweet
  let pickerQuery = $state(''); // search box, shown once the picker holds >6 items

  // path → media kind, from our own /media shelf, so attach chips can label a
  // video without scanning the whole entity graph. Refreshed on case change. The
  // titles ride along for `#video`, which says a video's title and never its file name.
  let kindByPath = $state(new Map());
  let titleByPath = $state(new Map());
  // and the rows themselves, for the picture a post card shows (their thumbnails)
  let mediaByPath = $state(new Map());
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      kindByPath = new Map();
      titleByPath = new Map();
      mediaByPath = new Map();
      return;
    }
    let live = true;
    api
      .get(`/api/cases/${id}/media`)
      .then((items) => {
        if (!live) return;
        kindByPath = new Map(items.map((it) => [it.path, it.kind]));
        titleByPath = new Map(items.map((it) => [it.path, videoTitle(it)]));
        mediaByPath = new Map(items.map((it) => [it.path, it]));
      })
      .catch(() => {
        if (!live) return;
        kindByPath = new Map();
        titleByPath = new Map();
        mediaByPath = new Map();
      });
    return () => { live = false; };
  });

  // Proof picker modal
  let proofPickerOpen = $state(false);
  let proofLibrary = $state([]);

  let postFor = $state(undefined); // id of the case the form's content belongs to

  // reset the draft form when the case changes (close/switch/one-shot). A save still
  // pending goes to the case the post was written in, as it stood.
  $effect(() => {
    const id = caseState.current?.id;
    if (id === postFor) return;
    untrack(() => {
      const pending = autosave.pending ? draftBody() : null;
      autosave.cancel();
      postFor = id;
      resetDraft();
      if (pending) writeDraft(pending).catch((e) => toast(`Post not saved: ${e.message}`, 'danger'));
    });
  });

  // Ingest a proof handed over by the Proof Composer
  $effect(() => {
    const p = uiState.postProof;
    if (!p) return;
    uiState.postProof = null;
    untrack(() => adoptProof(p));
  });

  /**
   * A proof arriving from the Proof Composer opens its own thread. The one on
   * screen is filed under its own name first and then makes way, so sending a
   * second proof over does not write over the post the first one produced.
   * Re-sending the proof this thread already carries stays in place instead —
   * that is the same piece of work, edited. A post of the proof the case holds as a
   * draft opens as it was left rather than a second one starting; one that went out
   * is done, and the proof starts a new one.
   */
  async function adoptProof(p) {
    const caseId = caseState.current?.id;
    const sameOnScreen = !!p.png && p.png === proofPng;
    if (!(sameOnScreen && liveState === 'draft') && p.png && caseId) {
      const drafts = await api.get(`/api/cases/${caseId}/drafts`).catch(() => null);
      if (caseState.current?.id !== caseId) return;
      const { open, posted } = proofPosts(drafts, p.png, { except: draftName });
      if (open) {
        if (!(await letGo())) return;
        await loadDraft(open.name);
        if (draftName === open.name) toast('Opened its post in progress', 'ok', 2400);
        return;
      }
      if (posted || sameOnScreen) {
        if (await startProofPost(p, liveState)) toast('Its post went out, so this is a new one', 'info', 3200);
        return;
      }
    }
    await startProofPost(p, liveState);
  }

  /** The proof in the thread on screen, or in a fresh one once that is filed. Answers whether it went in. */
  async function startProofPost(p, standing) {
    const plan = planProofHandoff({ incomingPng: p.png, currentPng: proofPng, hasContent, standing });
    if (plan === 'file-then-apply') {
      if (!(await fileCurrentDraft())) return false;
      resetDraft();
    } else if (!geolocation) {
      // a blank post of another kind: the proof starts a geolocation, on its own template
      resetDraft();
    }
    applyProof(p);
    return true;
  }

  // A post started from the gallery, the home or another tool's To Post (`post/start.js`).
  $effect(() => {
    const start = uiState.postStart;
    if (!start) return;
    uiState.postStart = null;
    untrack(() => adoptStart(start));
  });

  /** As a proof sent over does, a start files what is on screen first and makes way. */
  async function adoptStart({ kind: wanted, media, about }) {
    if (hasContent) {
      if (!(await fileCurrentDraft())) return;
    }
    if (normalizePostKind(wanted) === 'video') await beginThread(media?.[0]);
    else beginPost(wanted, media, about);
  }

  /**
   * Open a blank post of this kind, on that kind's default template (or its first start
   * when it has none), with these case files placed (`startMediaPlan`) and the words
   * the sending tool gave (`startFields`). A Geolocation post opens exactly as a blank
   * composer always has.
   */
  function beginPost(wanted, media = [], about = null) {
    resetDraft(normalizePostKind(wanted));
    postOpen = true;
    const said = startFields(about);
    if (said.description) description = said.description;
    if (said.date) date = said.date;
    if (said.credits) credits = said.credits;
    // The sending tool's name for it, unless another post holds that name: the
    // fresh number stays then, so the first save never meets another draft.
    if (said.name && !nameTaken(said.name)) postName = postTitle = said.name;
    const plan = startMediaPlan(kind, media, (path) => kindByPath.get(path));
    if (plan.first) {
      firstMedia = plan.first.mediaPaths;
      firstMediaType = plan.first.mediaType;
    }
    if (plan.media) {
      mediaEnabled = true;
      mediaText = retargetMediaTweetText(mediaText, mediaType, plan.media.mediaType, 2);
      mediaType = plan.media.mediaType;
      mediaPaths = plan.media.mediaPaths;
    }
    for (const group of plan.more) {
      const tweet = newPostMediaTweet(++extraSeq, extraTweets.length + 3, group.mediaType);
      tweet.mediaPaths = group.mediaPaths;
      extraTweets.push(tweet);
    }
    if (said.description || said.date || said.credits) regenerate();
  }

  /** Whether a saved post other than the open one already holds this name. */
  function nameTaken(name) {
    const own = (draftName ?? '').toLowerCase();
    const slug = slugify(name, 'draft').toLowerCase();
    return [...savedSlugs(draftEntities, 'draft')].some((one) => one.toLowerCase() === slug && one.toLowerCase() !== own);
  }

  /** What the composer holds is written before something else takes its place: it
   *  saves itself, so this only waits for what is pending. Answers whether it is on disk. */
  async function fileCurrentDraft() {
    return letGo();
  }

  // ---- a video thread ---------------------------------------------------------------

  /** A thread of this video before its places are read, in Recap first's words. */
  function newThread(video = null) {
    const layout = videoLayout();
    return {
      // `#video`: the analyst's title for the thread, empty until they give one. An older
      // draft holds none (null), and its `#video` says the video's title in Media as it did.
      title: '',
      video, order: layout.order, texts: { video: layout.video, place: layout.place }, first: null, extra: [],
      sheet: null, clip: null, link: false, slides: null, left: [], seconds: null, facts: {}, cut: 0, sheetState: '',
      // Recap first's picture: the proofs sheet, as every thread had before, or the places
      // on a map (`lib/recapMap.js`), its choices, and the file made when the thread last
      // needed its picture with the choices it was made for (`mapFor`). `mapLive` is
      // whether its tiles may be asked for, never saved: the analyst pressed for the map.
      // `mapState` is 'making' while the map is drawn and filed.
      recap: 'sheet', map: null, mapFor: null, mapOptions: mapOptions(), mapLive: false, mapState: '',
      // the recap and the video's text each order was left with in this post, and the
      // words of each post the analyst rewrote, kept through an order that has no such post
      byOrder: {},
      written: {},
    };
  }

  /** A saved thread as this build reads it: what it says, the default start for what it does not. */
  function threadFrom(s) {
    const layout = videoLayout({ order: s.order, body: s.body, posts: s.posts });
    const path = (value) => (typeof value === 'string' && value ? value : null);
    return {
      ...newThread(path(s.video)),
      title: typeof s.title === 'string' ? s.title : null,
      recap: s.recap === 'map' ? 'map' : 'sheet',
      // a draft keeps its map only while it is the one its choices draw
      map: path(s.map),
      mapFor: path(s.map) ? mapOptions(s.mapOptions) : null,
      mapOptions: mapOptions(s.mapOptions),
      order: layout.order,
      texts: { video: layout.video, place: layout.place },
      first: typeof s.first === 'string' ? s.first : null,
      extra: Array.isArray(s.extra) ? s.extra.map((one) => ({ text: String(one?.text ?? '') })) : [],
      sheet: path(s.sheet),
      clip: path(s.clip),
      link: s.link === true,
    };
  }

  /** What a draft keeps of its thread, each piece only when it says something. */
  function threadRecord() {
    return {
      video: thread.video,
      ...(thread.title !== null ? { title: thread.title } : {}),
      order: thread.order,
      posts: [{ role: 'video', body: thread.texts.video }, { role: 'place', body: thread.texts.place }],
      ...(thread.first ? { first: thread.first } : {}),
      ...(thread.extra.length ? { extra: thread.extra.map((one) => ({ text: one.text })) } : {}),
      ...(thread.sheet ? { sheet: thread.sheet } : {}),
      ...(thread.recap === 'map' ? { recap: 'map', mapOptions: { ...thread.mapOptions } } : {}),
      ...(madeMap() ? { map: thread.map } : {}),
      ...(thread.clip ? { clip: thread.clip } : {}),
      ...(thread.link ? { link: true } : {}),
    };
  }

  /** The video's places as the strip reads them, and how long it runs: `{ slides, left, seconds }`, or null. */
  async function readThread(caseId, video) {
    const [answer, probe] = await Promise.all([
      api.get(`/api/cases/${caseId}/scenes?video=${encodeURIComponent(video)}`).catch(() => null),
      api.get(`/api/cases/${caseId}/inspect/probe?path=${encodeURIComponent(video)}`).catch(() => null),
    ]);
    if (!answer) return null;
    const { slides, left } = videoSlides(answer);
    const seconds = Number.isFinite(probe?.duration) && probe.duration > 0 ? probe.duration : null;
    return { slides, left, seconds };
  }

  /**
   * Post a video's proofs as one thread: its places read, laid out in this kind's
   * default order and words, named after the video, and its contact sheet filed when
   * the order shows one. A video of fewer than two proofs to post is no thread.
   */
  async function beginThread(video) {
    const caseId = caseState.current?.id;
    if (!caseId || !video) return;
    resetDraft('video');
    postOpen = true;
    thread.video = video;
    const run = postRun;
    const read = await readThread(caseId, video);
    if (run !== postRun || !thread) return;
    if (!read || read.slides.length < THREAD_MIN) {
      toast(read ? 'This video has fewer than two proofs to post. Each one can go out as a geolocation.' : 'The proofs of this video could not be read', 'warn', 5200);
      resetDraft();
      return;
    }
    Object.assign(thread, read);
    // the places on a map when they stand far enough apart, signed as the analyst's proofs are
    thread.recap = recapFit(recapPlaces(read.slides)).ok ? 'map' : 'sheet';
    const style = defaultProofTemplate(templatesState.proof, prefs.proofTemplate)?.data ?? null;
    thread.mapOptions = mapOptions({ signature: !!(style?.signature || style?.signatureText), mark: !!style?.azimutMark });
    source = videoLink(mediaByPath.get(video));
    layoutThread();
    await Promise.all([fileSheetIfShown(), readPlaceFacts()]);
  }

  /** The recap's picture: the map or the proofs sheet. Picking the map asks for its tiles. */
  function setRecap(kind) {
    if (!thread) return;
    thread.recap = kind === 'map' ? 'map' : 'sheet';
    if (thread.recap === 'map') thread.mapLive = true;
    layoutThread();
    fileSheetIfShown();
  }

  /** Whether two sets of the map's choices draw the same map. */
  const sameMap = (a, b) => !!a && !!b && JSON.stringify(mapOptions(a)) === JSON.stringify(mapOptions(b));

  /** The recap map made for the thread's choices as they stand, or null. */
  const madeMap = () => (thread?.map && sameMap(thread.mapFor, thread.mapOptions) ? thread.map : null);

  // The recap carries the map and none made matches its choices: it is made when the
  // thread needs its picture (Publish, the hand-off, Copy, Download), never on a choice.
  const mapPending = $derived(!!thread?.slides && thread.order === 'recap' && thread.recap === 'map'
    && recapFit(recapPlaces(thread.slides)).ok && !madeMap());

  /** A choice of the map changed: the recap carries the map made for it, or waits for one. Nothing is filed. */
  function setMapOptions(patch) {
    if (!thread) return;
    const before = madeMap();
    thread.mapOptions = mapOptions({ ...thread.mapOptions, ...patch });
    // a ground picked is a press for the map
    if ('background' in patch) thread.mapLive = true;
    if (madeMap() !== before) layoutThread();
  }

  // The making under way, shared by every press that needs the map: `{ options, run }`.
  let mapMaking = null;

  /** Draw the map whole for these choices and file it: the recap carries it. Answers `{ ok, error? }`. */
  async function makeMapFor(options) {
    const caseId = caseState.current?.id;
    const run = postRun;
    thread.mapState = 'making';
    try {
      const path = await makeRecapMap(caseId, { video: thread.video, slides: thread.slides, options });
      if (run !== postRun || !thread) return { ok: false, gone: true };
      thread.map = path;
      thread.mapFor = options;
      // its tiles were asked on this press: the preview shows them too
      thread.mapLive = true;
      layoutThread();
      await tick();
      if (altOn) await prefillAlt(run);
      return { ok: true };
    } catch (error) {
      return { ok: false, error, gone: run !== postRun || !thread };
    } finally {
      if (run === postRun && thread) thread.mapState = '';
      if (mapMaking?.options === options) mapMaking = null;
    }
  }

  /**
   * The recap map a press needs, made first when the recap carries the map and none made
   * matches its choices. Answers whether the press may go on; when the map could not be
   * made, `stopped` says so, with a report to copy.
   */
  async function readyRecapMap(stopped) {
    // a choice changed while it was made: made again for the choice that stands
    for (let tries = 0; mapPending && tries < 3; tries += 1) {
      const options = { ...thread.mapOptions };
      if (!mapMaking || !sameMap(mapMaking.options, options)) mapMaking = { options, run: makeMapFor(options) };
      const made = await mapMaking.run;
      if (made.gone) return false;
      if (!made.ok) {
        sayMapFailed(stopped, made.error, options);
        return false;
      }
    }
    return !mapPending;
  }

  /** The map could not be made: one sentence, and what happened for a report. */
  function sayMapFailed(stopped, error, options) {
    const report = [
      'Recap map not made',
      `Video: ${thread?.video ?? ''}`,
      `Places: ${recapPlaces(thread?.slides ?? []).length}`,
      `Background: ${BACKGROUND_NAMES[options.background]}${options.line ? ', line' : ''}${options.signature ? ', signature' : ''}${options.mark ? ', Azimut mark' : ''}`,
      `Error: ${error?.message ?? String(error)}`,
    ].join('\n');
    toast(stopped, 'warn', 12000, { label: 'Copy report', onClick: () => copyText(report, { said: 'Report copied' }) });
  }

  /** The recap's map, made first when it is to make, downloaded. */
  async function downloadRecapMap() {
    if (!(await readyRecapMap('The recap map could not be made, so nothing was downloaded.'))) return;
    const map = madeMap();
    if (map) downloadPostMedia([map]);
  }

  /** What `#video` says: the thread's title, or an older draft's video title in Media. */
  const threadTitle = () => thread.title ?? titleByPath.get(thread.video) ?? '';

  /** The thread's title typed: the posts not rewritten by hand say it at once. */
  function setThreadTitle(text) {
    if (!thread) return;
    thread.title = text;
    rewriteThread();
  }

  /** The thread as `lib/videoPost.js` writes it, from what the composer holds. */
  function threadInput() {
    return {
      video: { path: thread.video, title: threadTitle() },
      slides: thread.slides ?? [],
      layout: { order: thread.order, recap: body, video: thread.texts.video, place: thread.texts.place },
      common: { mention, source },
      sheet: thread.sheet,
      clip: thread.clip,
      link: thread.link,
      facts: thread.facts,
      extra: thread.extra,
      recap: thread.recap,
      map: madeMap(),
    };
  }

  /** A post of the thread as the composer holds it after post 1. */
  function threadTweet(post, written) {
    return {
      id: ++extraSeq,
      text: written.get(post.key) ?? post.text,
      mediaPaths: post.mediaPaths,
      mediaType: post.mediaType,
      isMediaTweet: post.mediaType !== 'none',
      mediaTextIncludesPrefix: true,
      key: post.key,
      edited: written.has(post.key),
    };
  }

  /**
   * The thread laid out again, in its order, with what each post carries: the words of
   * a post the analyst rewrote stay on it, and a post they added stays at the end.
   */
  function layoutThread() {
    if (!thread?.slides) return;
    const { posts, cut } = videoPosts(threadInput());
    const written = new Map(Object.entries(thread.written));
    if (tweet1Edited && thread.first) written.set(thread.first, tweet1);
    for (const one of extraTweets) if (one.key && one.edited) written.set(one.key, one.text);
    thread.written = Object.fromEntries(written);
    const added = extraTweets.filter((one) => !one.key);
    const [first, ...rest] = posts;
    thread.first = first.key;
    thread.cut = cut;
    tweet1 = written.get(first.key) ?? first.text;
    tweet1Edited = written.has(first.key);
    firstMedia = first.mediaPaths;
    firstMediaType = first.mediaType;
    mediaEnabled = false;
    mediaType = 'none';
    mediaPaths = [];
    mediaText = '';
    extraTweets = [...rest.map((post) => threadTweet(post, written)), ...added];
  }

  /** The words of every post the analyst left as written, from the fields again; post 1's too when asked. */
  function rewriteThread({ first = false } = {}) {
    if (!thread?.slides) return;
    const texts = new Map(videoPosts(threadInput()).posts.map((post) => [post.key, post.text]));
    if ((first || !tweet1Edited) && texts.has(thread.first)) {
      tweet1 = texts.get(thread.first);
      tweet1Edited = false;
      delete thread.written[thread.first];
    }
    for (const one of extraTweets) {
      if (one.key && !one.edited && texts.has(one.key)) one.text = texts.get(one.key);
    }
  }

  /** One post of the thread written from the fields again. */
  function rewritePost(tweet) {
    tweet.edited = false;
    delete thread.written[tweet.key];
    rewriteThread();
  }

  /** A thread's order and texts, from a template or a start: the posts follow. */
  function applyThreadLayout(layout, extra = thread.extra) {
    body = layout.recap;
    thread.order = layout.order;
    thread.texts = { video: layout.video, place: layout.place };
    thread.extra = (extra ?? []).map((one) => ({ text: String(one?.text ?? '') }));
    layoutThread();
    fileSheetIfShown();
    readPlaceFacts();
  }

  /**
   * Another order: the same places in another sequence, each with its words. Where the
   * thread opens and where its mention goes are the order's own, so the recap and the
   * video's post take that order's start, or the words they had in it earlier on.
   */
  function setThreadOrder(order) {
    if (!thread) return;
    thread.byOrder[thread.order] = { recap: body, video: thread.texts.video };
    const start = videoLayout(VIDEO_THREAD_STARTERS.find((one) => one.order === order));
    const known = thread.byOrder[order] ?? { recap: start.recap, video: start.video };
    body = known.recap;
    thread.texts.video = known.video;
    thread.order = order;
    layoutThread();
    fileSheetIfShown();
  }

  /** A clip in place of the whole video, or the whole video again (null). */
  function setThreadClip(path) {
    thread.clip = path;
    thread.link = false;
    layoutThread();
  }

  /** The video's link in place of the file, or the whole video again. */
  function setThreadLink(on) {
    thread.link = on;
    thread.clip = null;
    layoutThread();
  }

  /** The contact sheet, drawn and filed once the order shows one and none is filed yet. */
  async function fileSheetIfShown() {
    if (!thread?.slides || thread.sheet || thread.sheetState === 'making') return;
    if (!usesSheet(thread.order, thread.slides.length, thread.recap)) return;
    const caseId = caseState.current?.id;
    if (!caseId) return;
    const run = postRun;
    thread.sheetState = 'making';
    try {
      const path = await fileThreadSheet(caseId, { video: thread.video, slides: thread.slides });
      if (run !== postRun || !thread) return;
      thread.sheet = path;
      thread.sheetState = '';
      layoutThread();
    } catch {
      if (run === postRun && thread) thread.sheetState = 'failed';
    }
  }

  /**
   * Each place's address, read once a place's text names it (`#place`, `#pluscode`):
   * the plus code from its point, the place's name as the geolocation post reads it.
   */
  async function readPlaceFacts() {
    const wants = (tag) => new RegExp(`${tag}(?![\\p{L}\\p{N}_])`, 'iu').test(thread?.texts.place ?? '');
    if (!thread?.slides || !(wants('#place') || wants('#pluscode'))) return;
    const run = postRun;
    for (const slide of thread.slides) {
      if (thread.facts[slide.name]) continue;
      const point = (slide.row?.points ?? []).find((one) => Number.isFinite(one?.lat) && Number.isFinite(one?.lon));
      if (!point) continue;
      const parsed = await api.post('/api/geo/parse', { text: `${point.lat}, ${point.lon}` }).catch(() => null);
      const found = wants('#place') ? await api.get(`/api/geo/reverse?lat=${point.lat}&lon=${point.lon}`).catch(() => null) : null;
      if (run !== postRun || !thread) return;
      thread.facts[slide.name] = { place: found ? placeName(found) : '', plusCode: parsed?.plus_code ?? '' };
    }
    rewriteThread();
  }

  /** A post of the thread's name above it: a place's by its title, the others by what they are. */
  function threadLabel(key, type) {
    const [role, ...rest] = String(key ?? '').split(':');
    const proof = rest.join(':');
    const titles = new Map((thread?.slides ?? []).map((slide) => [slide.name, slide.label ?? slide.title]));
    return threadPostLabel({ role: role || null, proof, mediaType: type }, titles);
  }

  // What the thread's video is over on the platform picked, in words, while its post
  // carries the whole video: the panel offers a clip or the link then.
  const threadOver = $derived.by(() => {
    if (!thread?.video || thread.clip || thread.link || thread.order === 'all') return '';
    const facts = { seconds: thread.seconds, bytes: mediaByPath.get(thread.video)?.size ?? null };
    return overWords(target, videoFits(target, facts), facts);
  });

  function applyProof(p) {
    postOpen = true;
    // The proof's own sentence is what this field is for. A title is a filename,
    // and most of them are the number the composer handed out, so it only stands
    // in when the analyst renamed the proof and wrote no description.
    description = p.description?.trim()
      ? p.description.trim()
      : (isDefaultName(p.title, 'proof') ? '' : (p.title ?? ''));
    date = postDate(p.when, p.whenZone);
    proofUndated = !date;
    setTimecode(p.moments);
    const proofSourceUrl = p.source ?? p.sources?.[0] ?? '';
    source = proofSourceUrl;
    setProof(p.png ?? null);
    preloadProofMedia(p.png, proofSourceUrl);
    tweet1Edited = false;
    coordsText = p.coordsText
      ?? (p.coords ? `${p.coords.lat.toFixed(6)}, ${p.coords.lon.toFixed(6)}` : '');
    if (coordsText.trim()) resolveCoords();
    else regenerate();
  }

  // Consume an "open this draft" handoff from the sidebar
  $effect(() => {
    if (uiState.tool === 'post' && uiState.openDraft && caseState.current) {
      const name = uiState.openDraft;
      uiState.openDraft = null;
      requestLoadDraft(name);
    }
  });

  async function resolveCoords() {
    // The first line is the conclusion: it is what the place, the plus code, the
    // DMS and the map links are an address for. The rest are points the picture
    // also shows, carried into the tweet as written.
    const value = pointLines(coordsText)[0]?.coords ?? '';
    if (!value) {
      geo = null;
      regenerate();
      return;
    }
    try {
      geo = await api.post('/api/geo/parse', { text: value });
      regenerate();
    } catch {
      // The old point does not survive text that no longer resolves to it.
      // Leaving it in place kept the facts card, the tweet, the copy buttons and
      // the saved report publishing a location the input no longer shows.
      geo = null;
      regenerate();
      toast('Could not parse coordinates', 'danger');
      return;
    }
    // waited for, so a post filled from a proof is whole when this returns
    await lookupPlace();
  }

  async function lookupPlace() {
    if (!geo) return;
    placeLoading = true;
    try {
      const r = await api.get(`/api/geo/reverse?lat=${geo.lat}&lon=${geo.lon}`);
      place = placeName(r);
      regenerate();
    } catch {
      /* offline or Nominatim down — place stays manual */
    } finally {
      placeLoading = false;
    }
  }

  /** A reverse lookup's answer as the place line says it: village, state, country. */
  function placeName(r) {
    const a = r?.address ?? {};
    return [a.village || a.town || a.city || a.county, a.state, a.country].filter(Boolean).join(', ') || r?.display_name || '';
  }

  // A reply under the source leaves the line naming it, and the post shows it so.
  function buildTweet1() {
    return buildTweet1Lines(body, replying ? { ...tokenFields(), source: '' } : tokenFields());
  }

  /** The draft's facts as the tokens read them (lib/post.js `tweetFields`). */
  function tokenFields() {
    return {
      place,
      plusCode: geo?.plus_code,
      description,
      lat: geo?.lat,
      lon: geo?.lon,
      coordsText,
      mention,
      source,
      date,
      credits,
      video: postVideoTitle,
      timecode: timecodeText,
    };
  }

  /** The proof's stated moments as `#timecode` prints them; none for a photo or the whole video. */
  function setTimecode(moments) {
    timecodeText = timecode(moments);
    timecodeKnown = !!timecodeText;
  }

  // The video the post is about, for `#video`: the one its proof rests on, else the
  // first video it carries. Its title as Media gives it, or nothing.
  const postVideoPath = $derived(
    thread?.video
      || (proofPng && caseProofs?.find((row) => row.png === proofPng)?.video)
      || (firstMediaType === 'video' ? firstMedia[0] : null)
      || (mediaType === 'video' ? mediaPaths[0] : null)
      || null
  );
  const postVideoTitle = $derived(postVideoPath ? titleByPath.get(postVideoPath) ?? '' : '');
  // The title can land after the post was written from its fields: an untouched post
  // whose layout says `#video` is written again with it.
  $effect(() => {
    void postVideoTitle;
    untrack(() => {
      if (!tweet1Edited && tweet1.trim() && /#video(?![\p{L}\p{N}_])/iu.test(body)) regenerate();
    });
  });

  function regenerate() {
    // a thread writes each post it left as written, from the fields
    if (thread) {
      rewriteThread();
      return;
    }
    tweet1 = buildTweet1();
    tweet1Edited = false;
  }

  // ---- thread templates ----------------------------------------------------
  // Apply a saved post template (Settings → Templates). Content-free: only
  // the mention, token body, media flag and boilerplate extra tweets travel.
  // The thread structure laid over this draft: { name, prev } so "Discard" can
  // walk back to the structure the draft had before. UI-only, cleared whenever
  // the draft is reset or a saved one is opened.
  let appliedPostTemplate = $state(null);

  const TEMPLATE_FIELD_HINT = 'This template does not use this field.';

  function fieldDisabledByTemplate(field) {
    return !thread && !!appliedPostTemplate && !templateUsesPostField(body, field);
  }

  // A geolocation shows every field, as it always has. Another kind shows the fields
  // its layout uses, so a free post is not asked for coordinates. A video thread's
  // places bring their own facts: it asks for the mention and the video's link only,
  // when one of its texts says them.
  function fieldShown(field) {
    if (thread) {
      return ['mention', 'source'].includes(field)
        && [body, thread.texts.video, thread.texts.place].some((text) => templateUsesPostField(text, field));
    }
    return geolocation || templateUsesPostField(body, field);
  }

  // The four structural fields a template swaps, snapshotted for a clean restore.
  function snapshotPostStructure() {
    return {
      mention,
      body,
      mediaEnabled,
      replyChosen,
      layout: thread ? { order: thread.order, recap: body, ...thread.texts, extra: thread.extra.map((one) => ({ ...one })) } : null,
      extraTweets: extraTweets.map((e) => ({
        text: e.text,
        mediaPaths: [...e.mediaPaths],
        mediaType: e.mediaType,
        isMediaTweet: e.isMediaTweet === true,
        mediaTextIncludesPrefix: e.mediaTextIncludesPrefix === true,
      })),
    };
  }

  // `quiet` is a blank composer starting on the default template: no toast, and
  // nothing to rebuild since the draft holds no facts yet.
  function applyPostTemplate(t, { quiet = false } = {}) {
    // first apply snapshots the current structure; re-applying keeps that
    // original, so Discard always returns to the pre-template layout.
    const prev = appliedPostTemplate?.prev ?? snapshotPostStructure();
    const norm = applyPostTemplateStructure({}, t.data);
    mention = norm.mention;
    if (thread) {
      // a thread's template is its order and its texts: the posts follow them
      appliedPostTemplate = { name: t.name, prev };
      applyThreadLayout(videoLayout(norm), norm.extraTweets);
      if (!quiet) toast(`Template loaded: ${t.name}`, 'ok', 1400);
      return;
    }
    body = norm.body;
    mediaEnabled = norm.mediaEnabled;
    replyChosen = replyByDefault(t.data);
    extraTweets = norm.extraTweets.map((e) => ({ id: ++extraSeq, ...e }));
    appliedPostTemplate = { name: t.name, prev };
    if (quiet) return;
    if (!tweet1Edited) regenerate();
    toast(`Template loaded: ${t.name}`, 'ok', 1400);
  }

  // A blank composer starts on the template chosen in Settings → Templates. One
  // whose template was since deleted just starts classic. Remove opts this draft
  // out, so the effect below never puts back what was taken off; the next blank
  // draft starts on it again.
  let defaultDeclined = false;

  // This kind's default, Geolocation's being the bookmark it always was (lib/post.js).
  const defaultTemplate = () => defaultPostTemplate(templatesState.post, kind, {
    geolocation: prefs.postTemplate,
    byKind: prefs.postKindTemplates,
  });
  // The templates this post can take: a kind's own, so a geolocation lists what it always did.
  const kindTemplates = $derived(templatesOfKind(templatesState.post, kind));

  function startFromDefaultTemplate() {
    // Another kind stands on its first layout, unnamed, so a free post is not written
    // as a geolocation, and its default's Remove comes back to that rather than to the
    // classic geolocation.
    const [starter] = kind === 'geolocation' ? [] : postStarters(kind);
    if (starter) {
      const norm = normPostTemplate({ body: starter.body, mediaEnabled: starter.mediaEnabled, mention });
      body = norm.body;
      mediaEnabled = norm.mediaEnabled;
      if (thread) applyThreadLayout(videoLayout(starter), []);
    }
    const t = defaultTemplate();
    if (t) applyPostTemplate(t, { quiet: true });
  }

  // The layouts every post of this kind can take as they ship (lib/post.js
  // `postStarters`), under the analyst's own in Thread style.
  const builtInLayouts = $derived(postStarters(kind));
  const BUILT_IN = 'built-in:';

  function applyPostFromSelect(e) {
    const value = e.target.value;
    e.target.value = '';
    if (value.startsWith(BUILT_IN)) {
      const starter = builtInLayouts.find((one) => one.id === value.slice(BUILT_IN.length));
      if (starter) applyBuiltInLayout(starter);
      return;
    }
    const t = kindTemplates.find((x) => x.id === value);
    if (t) applyPostTemplate(t);
  }

  /** A built-in layout changes the body only: the mention, the media post and the later posts stay. Remove goes back as a template's does. */
  function applyBuiltInLayout(starter) {
    const prev = appliedPostTemplate?.prev ?? snapshotPostStructure();
    appliedPostTemplate = { name: starter.label, prev };
    if (thread) {
      // a thread's start is an order and its texts, its closing posts kept
      applyThreadLayout(videoLayout(starter));
      toast(`Layout loaded: ${starter.label}`, 'ok', 1400);
      return;
    }
    body = starter.body;
    if (!tweet1Edited) regenerate();
    toast(`Layout loaded: ${starter.label}`, 'ok', 1400);
  }

  function discardPostTemplate() {
    if (!appliedPostTemplate) return;
    const p = appliedPostTemplate.prev;
    mention = p.mention;
    if (thread && p.layout) {
      appliedPostTemplate = null;
      defaultDeclined = true;
      applyThreadLayout(p.layout, p.layout.extra);
      toast('Template removed', 'ok', 1200);
      return;
    }
    body = p.body;
    mediaEnabled = p.mediaEnabled;
    replyChosen = p.replyChosen === true;
    extraTweets = p.extraTweets.map((e) => ({
      id: ++extraSeq,
      text: e.text,
      mediaPaths: [...(e.mediaPaths ?? [])],
      mediaType: e.mediaType ?? 'none',
      isMediaTweet: e.isMediaTweet === true,
      mediaTextIncludesPrefix: e.mediaTextIncludesPrefix === true,
    }));
    appliedPostTemplate = null;
    defaultDeclined = true;
    if (!tweet1Edited && tweet1.trim()) regenerate();
    toast('Template removed', 'ok', 1200);
  }

  function openTemplateSettings() {
    uiState.settingsTab = 'templates';
    uiState.tool = 'settings';
  }

  function targetLength(text) {
    // Count the bidi-safe text that gets copied, so coordinates, plus codes,
    // mentions and URLs stay honest in right-to-left posts too.
    return postCharacterCount(target, bidiSafe(text));
  }

  function tweet2Text() {
    return mediaText.trim();
  }

  const tweet1Count = $derived(targetLength(tweet1));
  const tweet1Over = $derived(tweet1Count > targetInfo.limit);

  function addExtraTweet() {
    extraTweets.push({
      id: ++extraSeq, text: '', mediaPaths: [], mediaType: 'none',
      isMediaTweet: false,
      mediaTextIncludesPrefix: false,
    });
  }

  function addMediaTweet() {
    extraTweets.push(newPostMediaTweet(++extraSeq, extraTweets.length + 3));
  }

  function removeExtraTweet(id) {
    const i = extraTweets.findIndex((t) => t.id === id);
    if (i === -1) return;
    extraTweets.splice(i, 1);
    for (let j = i; j < extraTweets.length; j += 1) {
      const tweet = extraTweets[j];
      if (!tweet.mediaTextIncludesPrefix || tweet.mediaType === 'none') continue;
      tweet.text = renumberMediaTweetText(tweet.text, tweet.mediaType, j + 4, j + 3);
    }
  }

  function extraTweetText(tweet, number) {
    return extraPostTweetText(tweet, number);
  }

  // Copies go through bidiSafe so coordinates, plus codes, mentions and URLs
  // keep reading left-to-right in Arabic or Hebrew posts (see lib/bidi).
  async function copy(value) {
    await copyText(bidiSafe(value));
  }

  function threadParts(first = tweet1) {
    const parts = [first];
    if (mediaEnabled && mediaType !== 'none') parts.push(tweet2Text());
    for (let i = 0; i < extraTweets.length; i += 1) {
      const tweet = extraTweets[i];
      const text = extraTweetText(tweet, i + 3);
      if (text) parts.push(text);
    }
    return parts.filter((part) => part.trim());
  }

  async function copyAll(showToast = true, first = tweet1) {
    const parts = threadParts(first);
    return copyText(parts.map(bidiSafe).join('\n\n---\n\n'), { said: 'All posts copied', quiet: !showToast });
  }

  // A thread's recap needs its picture once its words are copied: the words go first,
  // while the press still lets the page write the clipboard, then the map is made.
  async function copyAllPressed() {
    await copyAll();
    await readyRecapMap('The posts are copied, but the recap map could not be made.');
  }

  async function copyFirst() {
    await copy(tweet1);
    await readyRecapMap('The post is copied, but the recap map could not be made.');
  }

  // ---- media picker -------------------------------------------------------

  async function openPicker(target = null) {
    if (!caseState.current) {
      toast('Open a case to pick from your media', 'warn');
      return;
    }
    try {
      mediaLibrary = await api.get(`/api/cases/${caseState.current.id}/media`);
      mediaPickerTarget = target === 'first' ? 'first' : normalizePostMediaPickerTarget(target);
      pickerQuery = '';
      pickerOpen = true;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  function pickerTweet() {
    if (mediaPickerTarget === 'first') return { mediaPaths: firstMedia, mediaType: firstMediaType };
    return mediaPickerTarget === null
      ? { mediaPaths, mediaType }
      : extraTweets.find((tweet) => tweet.id === mediaPickerTarget);
  }

  function pickerItems() {
    return postMediaForType(mediaLibrary, pickerTweet()?.mediaType);
  }

  // The picker narrows by a search box once the list grows past six. Reuses the
  // Media Library matcher (filename/title/notes/source).
  function visiblePickerItems() {
    const items = pickerItems();
    const q = pickerQuery.trim();
    return q ? items.filter((m) => matchesQuery(m, q)) : items;
  }

  function pickerTitle() {
    const tweet = pickerTweet();
    const kind = tweet?.mediaType === 'video' ? 'videos' : 'images';
    return `Choose ${kind} (${tweet?.mediaPaths.length ?? 0}/${MAX_POST_MEDIA})`;
  }

  function pickMedia(item) {
    const tweet = pickerTweet();
    if (!tweet) return;
    const selection = togglePostMedia(tweet, item);
    if (selection.outcome === 'unsupported') {
      toast('Post media must be an image or video', 'warn');
      return;
    }
    if (selection.outcome === 'limit') {
      toast(`A post can hold up to ${MAX_POST_MEDIA} media files`, 'warn');
      return;
    }
    if (mediaPickerTarget === 'first') {
      firstMedia = selection.mediaPaths;
      firstMediaType = selection.mediaType;
    } else if (mediaPickerTarget === null) {
      mediaText = retargetMediaTweetText(mediaText, mediaType, selection.mediaType, 2);
      mediaPaths = selection.mediaPaths;
      mediaType = selection.mediaType;
    } else {
      tweet.mediaPaths = selection.mediaPaths;
      tweet.mediaType = selection.mediaType;
    }
  }

  function clearMedia(path) {
    mediaPaths = mediaPaths.filter((entry) => entry !== path);
  }

  function clearFirstMedia(path) {
    firstMedia = firstMedia.filter((entry) => entry !== path);
  }

  function setFirstMediaType(type) {
    if (firstMediaType === type) return;
    firstMedia = [];
    firstMediaType = type;
  }

  function clearExtraMedia(id, path) {
    const tweet = extraTweets.find((entry) => entry.id === id);
    if (!tweet) return;
    tweet.mediaPaths = tweet.mediaPaths.filter((entry) => entry !== path);
  }

  function setMediaType(type) {
    if (mediaType === type) return;
    mediaPaths = [];
    mediaText = retargetMediaTweetText(mediaText, mediaType, type, 2);
    mediaType = type;
  }

  function setExtraMediaType(tweet, type) {
    if (tweet.mediaType === type) return;
    const number = extraTweets.findIndex((entry) => entry.id === tweet.id) + 3;
    tweet.mediaPaths = [];
    if (tweet.mediaTextIncludesPrefix) {
      tweet.text = retargetMediaTweetText(tweet.text, tweet.mediaType, type, number);
    }
    tweet.mediaType = type;
    tweet.isMediaTweet = true;
  }

  // ---- proof picker -------------------------------------------------------

  /** Assign the attached proof and bump the cache-buster so the preview always
   *  reflects the current file — proofs default to the same slug/filename, so
   *  the URL alone can be identical across different proofs. */
  function setProof(png) {
    proofPng = png;
    proofVer = png ? Date.now() : 0;
  }

  /**
   * The clip cut for the proof's post (`GET /proofs/{name}/clip`), `{ video, path }`, or
   * null: none cut, its file gone, or a proof that rests on no video.
   */
  async function proofClip(cid, png) {
    const row = (caseProofs ?? []).find((one) => one.png === png);
    // a proof the list knows rests on no video: it has no clip to ask for
    if (row && !row.video) return null;
    const name = row?.name ?? /^proofs\/([^/]+)\.png$/.exec(png)?.[1];
    if (!name) return null;
    try {
      const said = await api.get(`/api/cases/${cid}/proofs/${encodeURIComponent(name)}/clip`);
      const path = said?.clip?.path;
      return typeof path === 'string' && path ? { video: said.video ?? null, path } : null;
    } catch {
      return null;
    }
  }

  /**
   * The proof's source media, placed on the media post and the ones after it. A clip cut
   * for the post goes in place of the whole video it came from, which the media post's
   * Edit media still offers.
   */
  async function preloadProofMedia(png, proofSourceUrl) {
    if (!png || !caseState.current) return;
    try {
      const cid = caseState.current.id;
      const [proof, clip] = await Promise.all([
        proofSourceUrl ? lookupEntity(cid, 'path', png) : null,
        proofClip(cid, png),
      ]);
      if (!proof && !clip) return;
      const [library, graph] = await Promise.all([
        api.get(`/api/cases/${cid}/media`),
        proof ? fetchDerivation(cid, proof.id) : null,
      ]);
      const listed = Array.isArray(library) ? library : [];
      const kinds = new Map(listed.map((item) => [item.path, item.kind]));
      // the clip's file in the case, or the video as it always was
      const cut = clip && kinds.has(clip.path) ? clip : null;
      const linkedMedia = withPostClip(graph ? proofSourceMediaPaths(graph, png, proofSourceUrl, listed) : [], cut);
      if (!linkedMedia.length) return;

      const selected = new Set([
        ...mediaPaths,
        ...extraTweets.flatMap((tweet) => tweet.mediaPaths),
      ]);
      const added = linkedMedia.filter((path) => !selected.has(path));
      if (!added.length) return;
      const groups = groupPostMedia(added, (path) => kinds.get(path) ?? mediaKind(path));

      if (!mediaPaths.length && groups.length) {
        const first = groups.shift();
        mediaPaths = first.mediaPaths;
        mediaEnabled = true;
        const nextType = first.mediaType;
        mediaText = retargetMediaTweetText(mediaText, mediaType, nextType, 2);
        mediaType = nextType;
      }
      for (const group of groups) {
        const tweet = newPostMediaTweet(++extraSeq, extraTweets.length + 3, group.mediaType);
        tweet.mediaPaths = group.mediaPaths;
        extraTweets.push(tweet);
      }
      const files = (count) => `${count} source media ${count === 1 ? 'file' : 'files'}`;
      const others = added.filter((path) => path !== cut?.path).length;
      if (!cut || !added.includes(cut.path)) toast(`${files(added.length)} added to the thread`, 'ok', 2000);
      else toast(others ? `The proof's clip and ${files(others)} added to the thread` : "The proof's clip added to the thread", 'ok', 2000);
    } catch {
      /* Media selection is a convenience; attaching the proof still works offline. */
    }
  }

  async function openProofPicker() {
    if (!caseState.current) {
      toast('Open a case to pick a proof', 'warn');
      return;
    }
    try {
      proofLibrary = await api.get(`/api/cases/${caseState.current.id}/proofs`);
      proofPickerOpen = true;
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function pickProof(item) {
    setProof(item.png);
    proofPickerOpen = false;
    const blank = !description.trim();
    if (blank && item.title && !isDefaultName(item.title, 'proof')) {
      description = item.title;
    }
    // Pull the proof's coordinates + source into the post so the fields fill in.
    try {
      const spec = await api.get(`/api/cases/${caseState.current.id}/proofs/${encodeURIComponent(item.name)}`);
      // Its sentence, once the spec is here. The picker row carries a filename
      // and a thumbnail, so the title above was only ever a stand-in for this.
      if (blank && spec.description?.trim()) description = spec.description.trim();
      // The zone the date was stated in travels beside it, so a time reads on the
      // clock of the place and a day stays that place's day.
      date = postDate(spec.when, spec.whenZoneStated ?? spec.whenZone);
      proofUndated = !date;
      setTimecode(spec.scene?.moments);
      const src = proofSource(spec);
      if (src) source = src;
      await preloadProofMedia(item.png, src);
      const ct = proofCoordsText(spec);
      if (ct) { coordsText = ct; await resolveCoords(); return; }
    } catch {
      /* fall through to a plain regenerate */
    }
    regenerate();
  }

  function clearProof() {
    setProof(null);
  }

  function mediaHref(path) {
    return path && caseState.current ? fileUrl(caseState.current.id, path) : null;
  }

  function mediaKind(path) {
    return kindByPath.get(path) ?? 'image';
  }

  const proofHref = $derived(
    proofPng && caseState.current
      ? `${fileUrl(caseState.current.id, proofPng)}${proofVer ? `?v=${proofVer}` : ''}`
      : null
  );

  // ---- one-click image copy / media download ------------------------------

  /** Rasterise any image blob to PNG so it can be pasted into a social composer. */
  function toPngBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('encode failed'))), 'image/png');
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('load failed'));
      };
      img.src = url;
    });
  }

  /** Copy an image into the clipboard for the selected social composer. */
  async function copyImage(url) {
    try {
      await putImageOnClipboard(url);
      toast(`Image copied. Paste it into ${targetInfo.label}.`, 'ok', 2400);
    } catch (e) {
      toast(`Could not copy image: ${e.message}`, 'danger');
    }
  }

  async function putImageOnClipboard(url) {
    const res = await fetch(url);
    let blob = await res.blob();
    if (blob.type !== 'image/png') blob = await toPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  function triggerMediaDownload(url, path) {
    const a = document.createElement('a');
    a.href = url;
    a.download = (path ?? '').split('/').pop() || 'media';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  /** Download every attachment from one post. */
  function downloadPostMedia(paths) {
    for (const path of paths) triggerMediaDownload(mediaHref(path), path);
    toast(
      paths.length === 1
        ? `Media downloaded. Drag it into ${targetInfo.label}.`
        : `${paths.length} media files downloaded. Drag them into ${targetInfo.label}.`,
      'info',
      2600,
    );
  }

  // ---- alt text (lib/postAlt.js) ------------------------------------------
  // One box beside the post's first picture puts an Alt text field under every picture
  // of the post, never under a video. Off by default: a new post starts the way the
  // last one left it (`post_alt_text`), and a saved post that keeps a text opens with it
  // on. A field starts once with what the case says of its picture and keeps what the
  // analyst writes over it. The texts are kept by picture, so a text follows its picture
  // into another post when a video thread is laid out again.
  let altOn = $state(false);
  let altTexts = $state({}); // case path → its text
  let altSeen = new Set(); // the pictures already given their first words
  const proofWords = new Map(); // a proof's sentence, by case and picture, read once

  /** The pictures of the post on screen, each once, in thread order. */
  const altPictures = $derived.by(() => {
    const pictures = (paths, type) => (type === 'images' ? paths : []);
    return [...new Set([
      ...(geolocation ? (proofPng ? [proofPng] : []) : pictures(firstMedia, firstMediaType)),
      ...(mediaEnabled ? pictures(mediaPaths, mediaType) : []),
      ...extraTweets.flatMap((tweet) => pictures(tweet.mediaPaths, tweet.mediaType)),
    ])];
  });

  // The box sits in the first post that shows a picture.
  const altBoxAt = $derived(
    (geolocation ? !!proofPng : firstMediaType === 'images' && firstMedia.length > 0) ? 'first'
      : mediaEnabled && mediaType === 'images' && mediaPaths.length ? 'media'
        : extraTweets.find((tweet) => tweet.mediaType === 'images' && tweet.mediaPaths.length)?.id ?? null
  );

  /** The box ticked or not: this post's fields, and how the next post starts. */
  function setAltOn(on) {
    altOn = on;
    if (prefs.postAltText === on) return;
    prefs.postAltText = on;
    api.put('/api/settings/prefs', { post_alt_text: on })
      .catch(() => toast('The Alt text box could not be kept for the next posts', 'warn'));
  }

  function editAlt(path, text) {
    altTexts[path] = text;
  }

  function copyAlt(text) {
    copyText(text, { said: 'Alt text copied' });
  }

  /** What the case says of a picture, for its field's first words, or ''. */
  async function altWords(path) {
    const count = thread?.slides?.length ?? 0;
    if (thread?.sheet === path) return altSuggestion({ role: 'sheet', count });
    if (thread?.map === path) return altSuggestion({ role: 'map', count });
    const proof = /^proofs\/([^/]+)\.png$/.exec(path)?.[1];
    if (proof) return altSuggestion({ role: 'proof', description: await proofSentence(proof, path) });
    if (firstMedia.includes(path)) return altSuggestion({ role: 'start', kind, name: postTitle, date });
    return '';
  }

  /** A proof's own sentence: a thread's place says it, any other proof is read once. */
  async function proofSentence(name, path) {
    const slide = (thread?.slides ?? []).find((one) => one.png === path);
    if (slide) return slide.row?.description ?? '';
    const caseId = caseState.current?.id;
    if (!caseId) return '';
    const key = `${caseId}\n${path}`;
    if (!proofWords.has(key)) {
      const spec = await api.get(`/api/cases/${caseId}/proofs/${encodeURIComponent(name)}`).catch(() => null);
      proofWords.set(key, typeof spec?.description === 'string' ? spec.description : '');
    }
    return proofWords.get(key);
  }

  /** Each picture not given its first words yet gets them, unless it holds a text already. */
  async function prefillAlt(run = postRun) {
    const fresh = altPictures.filter((path) => !altSeen.has(path));
    for (const path of fresh) altSeen.add(path);
    await Promise.all(fresh.map(async (path) => {
      const words = await altWords(path);
      if (run !== postRun || !words || altTexts[path]?.trim()) return;
      altTexts[path] = words;
    }));
  }

  $effect(() => {
    if (!altOn || opening) return;
    altPictures;
    untrack(() => prefillAlt());
  });

  /** What a save keeps of them: only while the box is on and a picture has a text. */
  function altState() {
    const kept = altOn ? altRecord(altTexts, altPictures) : null;
    return kept ? { alt: kept } : {};
  }

  // ---- draft persistence --------------------------------------------------

  /** What a save keeps: the thread, and whether it went out (`publish`) once that says something. */
  function snapshot() {
    const state = threadState();
    if (publishState) state.publish = publishRecord(state);
    return state;
  }

  function threadState() {
    return {
      description,
      coordsText,
      place,
      mention,
      source,
      date,
      // written only for a proof that states a time, so a photo's draft keeps its shape
      ...(timecodeText ? { timecode: timecodeText } : {}),
      proofPng,
      tweet1,
      tweet1Edited,
      target,
      body,
      mediaEnabled,
      mediaType,
      mediaText,
      mediaTextIncludesPrefix: true,
      mediaPaths: [...mediaPaths],
      // Kept for drafts saved by older app versions.
      mediaPath: mediaPaths[0] ?? null,
      extraTweets: extraTweets.map((t) => ({
        text: t.text,
        mediaPaths: [...t.mediaPaths],
        mediaType: t.mediaType ?? 'none',
        isMediaTweet: t.isMediaTweet === true,
        mediaTextIncludesPrefix: t.mediaTextIncludesPrefix === true,
        // a thread's post says which it is, and whether the analyst rewrote it
        ...(t.key ? { key: t.key, ...(t.edited ? { edited: true } : {}) } : {}),
      })),
      // Written only for a post that is not a geolocation, so a geolocation draft keeps
      // the shape every draft before kinds had.
      ...(statedPostKind(kind)
        ? { kind, firstMedia: [...firstMedia], firstMediaType }
        : {}),
      ...(thread ? threadRecord() : {}),
      // written only for a post that goes out as a reply under its source
      ...(replyChosen ? { reply: true } : {}),
      // written only when there is a credit line, so a draft without one keeps its shape
      ...(credits.trim() ? { credits } : {}),
      ...altState(),
    };
  }

  // ---- whether it went out ----------------------------------------------------------
  // `publishState` is the draft's `publish` record (lib/post.js `postState`): once the
  // analyst marked the post posted, where it went out and when, its link when they gave
  // one, and a print of the post as it was then (`mark`), so an edit after it reads as
  // changed since posted. Nothing of it is written before then. The header's control
  // (`post/PostedControl.svelte`) is where it is said.
  let publishState = $state(null);
  // The site was opened with the post (Publish, Reply, the extension's hand-off): Mark as
  // posted wears a soft accent until the post is marked or closed. Never saved.
  let openedNow = $state(false);
  // A link the extension caught for the post open, proposed and never kept by itself.
  let caughtLink = $state(null); // { url, site }
  let postedControl = $state(null);

  // What the post says and carries, as its print reads it: its platform and a first
  // post rebuilt from the fields are not what changed.
  function postPrint(state = threadState()) {
    const words = { ...state, tweet1: tweet1Edited ? tweet1 : null };
    delete words.target;
    // a picture's description is no change to what went out: its first words arrive on opening
    delete words.alt;
    return postFingerprint(JSON.stringify(words));
  }

  function publishRecord(state) {
    const record = { ...publishState };
    if (postState(record) !== 'draft') record.changed = postPrint(state) !== record.mark;
    return record;
  }

  const liveState = $derived(postState(publishState ? publishRecord(threadState()) : null));
  // the day it went out: its link's own, else the moment it was marked
  const postedOnDay = $derived(
    publishState ? postedDay(postedWhen({ url: publishState.url, at: publishState.posted_at })) : ''
  );

  /** The site opened with the post: Mark as posted waits for it in the accent. */
  function markOpened() {
    openedNow = true;
  }

  /**
   * Mark as posted, from the header's popover or a caught link kept: the analyst's word
   * that the post went out, at this link or with none. A post already out keeps its day
   * and its print and only takes the link given, or loses the one it had.
   */
  function markPosted(url) {
    const found = url ? postedAddress(url) : null;
    if (liveState !== 'draft') {
      const next = { ...publishState, site: found?.site ?? publishState.site ?? target };
      if (found) next.url = found.url;
      else delete next.url;
      publishState = next;
      toast(found ? 'Link saved' : 'Link removed', 'ok', 1600);
    } else {
      publishState = {
        site: found?.site ?? target, ...(found ? { url: found.url } : {}),
        posted_at: new Date().toISOString(), mark: postPrint(),
      };
      toast('Marked as posted', 'ok', 1800);
    }
    openedNow = false;
    caughtLink = null;
  }

  /** Not posted: marked by mistake. The post is a draft again, and its proof lets it go. */
  function unmarkPosted() {
    publishState = null;
    toast('Back to Draft', 'ok', 1600);
  }

  /**
   * A saved post other than the open one, marked from its card on the home or from a link
   * the extension caught for it, through its own route: only its record changes. The
   * home and an Open list up read the case's posts again.
   */
  async function markSavedPost(entry, url, { posted = true } = {}) {
    const caseId = caseState.current?.id;
    if (!caseId || !entry?.name) return;
    try {
      await api.put(`/api/cases/${caseId}/drafts/${encodeURIComponent(entry.name)}/publish`,
        posted ? { posted: true, url: url ?? null } : { posted: false });
      toast(posted ? 'Marked as posted' : 'Back to Draft', 'ok', 1800);
      if (listsFor === caseId) readLists(caseId);
      if (openList !== null) openDraftList();
    } catch (e) {
      toast(`Not marked: ${e.message}`, 'danger');
    }
  }

  // What the extension's bridge says of a thread it handed out (lib/extBridge.js). A link
  // it caught is only proposed: on the post open, in the header; for another post of the
  // case, in a toast. One for another case is not this tab's. Heard once mounted.
  $effect(() => onPostLinkCaught((link) => {
    const id = caseState.current?.id;
    if (!id || link.caseId !== id) return;
    if (draftName && link.draft === draftName) {
      if (link.url !== publishState?.url) caughtLink = { url: link.url, site: link.site };
      return;
    }
    // a post of this case, as its entities or its list know it
    const listed = (caseDrafts ?? []).find((row) => row.name === link.draft);
    if (!listed && !savedSlugs(draftEntities, 'draft').has(link.draft)) return;
    const title = listed ? postLabel(listed, caseProofs ?? []) : link.draft;
    toast(`Link caught for “${title}”`, 'info', 0, [
      { label: 'Keep', onClick: () => markSavedPost({ name: link.draft }, link.url) },
      { label: 'Not this one', onClick: () => {} },
    ]);
  }));
  // A hand-off that stopped on the post open, with the post its rest starts from, offers
  // Copy the rest: the browser lets the page write the clipboard on this press, where it
  // refused the extension.
  $effect(() => onPostHandoffReport((report) => {
    if (report.caseId !== caseState.current?.id) return;
    const rest = report.from && draftName && report.draft === draftName && report.from <= handoffPayload().posts.length
      ? [{ label: 'Copy the rest', onClick: () => copyRest(report.from) }]
      : [];
    const copyReport = report.report
      ? [{ label: 'Copy report', onClick: () => copyText(report.report, { said: 'Report copied' }) }]
      : [];
    const actions = [...rest, ...copyReport];
    toast(report.error, 'warn', 12000, actions.length > 1 ? actions : actions[0] ?? null);
  }));

  /** The posts of the thread from `from` (1 for the first) to the last, as the extension took them. */
  function copyRest(from) {
    const thread = handoffPayload().posts;
    const texts = thread.slice(from - 1).map((post) => post.text).filter((text) => text.trim());
    if (!texts.length) {
      toast('Those posts are no longer in the thread', 'warn');
      return;
    }
    const last = thread.length;
    copyText(texts.join('\n\n'), { said: last > from ? `Posts ${from} to ${last} copied` : `Post ${from} copied` });
  }

  // The note is titled after the post it is written from, so the two read as one piece
  // of work: its name, else its label. The dialog leaves it editable.
  const draftTitle = () => itemLabel('draft', postTitle, { place, when: [date], coords: geo ? [geo.lat, geo.lon] : null });

  // ---- saving itself ----------------------------------------------------------
  // `blankKey` is the post as it was opened or reset: a post that is still that saves
  // nothing. `writtenKey` is what the last write sent (or the draft as it was loaded),
  // so a write runs only when there is something new to keep. `postRun` counts the
  // posts opened, so a write that lands after another post took the screen binds nothing.
  let blankKey = $state(null);
  let writtenKey = null;
  let postRun = 0;
  let opening = $state(false); // a saved draft is being laid out: nothing to write yet

  const saveKey = (state, title) => JSON.stringify({ state, title });

  /** What a write would send now, or null when there is nothing to keep. */
  function draftBody() {
    const caseId = postFor;
    if (!caseId || opening) return null;
    if (!draftName && contentKey() === blankKey) return null;
    const state = snapshot();
    const typed = postTitle.trim() || freshPostName();
    // An unbound post whose name another draft took files under a fresh one rather
    // than write over it: there is nobody to ask, and nothing is ever written over.
    const title = filingName({
      title: typed,
      bound: !!draftName,
      takenSlugs: savedSlugs(draftEntities, 'draft'),
      slug: slugify(typed, 'draft'),
      fresh: freshPostName(),
    });
    const key = saveKey(state, title);
    if (key === writtenKey) return null;
    return { caseId, run: postRun, key, payload: { rename_from: draftName, title, state } };
  }

  async function writeDraft(body = draftBody(), opts = undefined) {
    if (!body) return;
    const r = await api.post(`/api/cases/${body.caseId}/drafts`, body.payload, opts);
    if (body.run !== postRun) return; // another post took the screen meanwhile
    const first = !draftName;
    draftName = r.name;
    if (!postName.trim() || postName.trim() === postTitle.trim() || postName.trim() === body.payload.title) postName = ownName(r.title, 'draft');
    postTitle = r.title;
    writtenKey = saveKey(body.payload.state, r.title);
    if (first) {
      // the sidebar and the next name count it now
      reloadCase();
      draftEntities = await fetchAllEntities(body.caseId, { types: ['post'] }).catch(() => draftEntities);
    }
  }

  const autosave = createAutosave({ write: () => writeDraft() });

  // Any change to a post that holds something is written once the typing stops.
  $effect(() => {
    const key = saveKey(snapshot(), postTitle.trim());
    if (!caseState.current || opening || blankKey === null) return;
    if (!draftName && contentKey() === blankKey) return;
    if (key === writtenKey) return;
    autosave.schedule();
  });

  // Leaving the tool is a moment to write rather than wait.
  $effect(() => {
    if (uiState.tool !== 'post') untrack(() => autosave.flush());
  });
  $effect(() => () => autosave.flush());

  function onpagehide() {
    if (autosave.pending) writeDraft(draftBody(), { keepalive: true }).catch(() => {});
  }

  /** The header's word on it: nothing for a post that holds nothing yet. */
  const saveStatus = $derived.by(() => {
    if (autosave.state.status === 'error') return 'error';
    if (autosave.state.status === 'pending' || autosave.state.status === 'saving') return 'saving';
    return draftName ? 'saved' : '';
  });

  /**
   * The name field is taken when it is left, as Inspect's is: renaming moves the file,
   * so it moves once rather than at every letter. A name another post holds is
   * refused. Cleared, the post goes back to a technical name and reads as its label.
   */
  function commitName() {
    const typed = postName.trim();
    if (!typed) {
      postName = '';
      if (!isDefaultName(postTitle, 'draft')) postTitle = technicalPostName();
      return;
    }
    if (typed === postTitle) return;
    if (nameTaken(typed)) {
      toast(`Another post is already named “${typed}”`, 'warn');
      postName = ownName(postTitle, 'draft');
      return;
    }
    postTitle = typed;
  }

  function nameKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      postName = ownName(postTitle, 'draft');
      event.currentTarget.blur();
    }
  }

  // Open: the dialog stands on the press, its rows following when the case answers. The
  // drafts and the proofs are read each time it opens, and the home under it takes them.
  let openListLoading = $state(false);
  async function openDraftList() {
    const caseId = caseState.current?.id;
    if (!caseId) return;
    openList ??= [];
    openListLoading = true;
    try {
      const [drafts, proofs] = await Promise.all([
        api.get(`/api/cases/${caseId}/drafts`),
        api.get(`/api/cases/${caseId}/proofs`).catch(() => null),
      ]);
      // closed while it was read: it stays closed
      if (openList === null || caseState.current?.id !== caseId) return;
      openList = drafts;
      if (listsFor === caseId) {
        listsRun += 1; // a read of the home's still on its way is older than this one
        caseDrafts = drafts;
        if (Array.isArray(proofs)) caseProofs = proofs;
      } else if (Array.isArray(proofs)) openProofs = proofs;
    } catch (e) {
      openList = null;
      toast(`The posts could not be read: ${e.message}`, 'warn');
    } finally {
      openListLoading = false;
    }
  }
  let openProofs = $state(null); // the proofs, read by Open when the home had not
  // Read again while it is up when the case moves: a delete, an Undo, a restore elsewhere.
  $effect(() => {
    caseState.rev;
    if (untrack(() => openList) !== null) untrack(() => openDraftList());
  });

  // ---- deleting a post ------------------------------------------------------------
  // From the header's ⋯ for the post open, a card on the home or the Open list: one
  // question with what the delete touches, the draft to the Trash, and Undo in the
  // toast. The post open goes back home once it is gone.
  let deleteEntry = $state(null); // { name, title, proof } pending deletion
  let deleting = $state(false);

  function askDelete(entry) {
    if (entry?.name) deleteEntry = { name: entry.name, title: entry.label || entry.title || entry.name, proof: entry.proof ?? null };
  }

  // A post deleted gives its proof back to Ready to post, unless another post names it:
  // the dialog says so, so the proof waiting there again reads as expected.
  const deleteFreesProof = $derived(
    !!deleteEntry?.proof
      && !(caseDrafts ?? []).some((row) => row.proof === deleteEntry.proof && row.name !== deleteEntry.name)
  );

  async function deleteSavedDraft() {
    const entry = deleteEntry;
    const caseId = caseState.current?.id;
    if (!entry || !caseId || deleting) return;
    deleting = true;
    const open = draftName === entry.name;
    try {
      // what is pending is written first, so the Trash keeps the post as it was left
      if (open) await autosave.flush();
      const result = await api.del(`/api/cases/${caseId}/drafts/${encodeURIComponent(entry.name)}`);
      deleteEntry = null;
      if (open && draftName === entry.name) {
        // gone on purpose: no word that the post was deleted behind the composer
        autosave.cancel();
        resetDraft();
      }
      deletedToast(caseId, result, entry.title);
      await reloadCase(); // the home and an Open list up read the case again
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      deleting = false;
    }
  }

  async function loadDraft(name) {
    if (!caseState.current) return;
    const run = ++postRun;
    opening = true;
    try {
      const doc = await api.get(`/api/cases/${caseState.current.id}/drafts/${encodeURIComponent(name)}`);
      if (run !== postRun) return;
      autosave.cancel();
      const s = doc.state ?? {};
      // a draft from before kinds says none, and is the geolocation it always was
      kind = normalizePostKind(s.kind);
      const own = kind !== 'geolocation';
      firstMedia = own && Array.isArray(s.firstMedia)
        ? s.firstMedia.filter((path) => typeof path === 'string').slice(0, MAX_POST_MEDIA)
        : [];
      firstMediaType = own && ['video', 'images'].includes(s.firstMediaType) ? s.firstMediaType : 'none';
      thread = kind === 'video' ? threadFrom(s) : null;
      postOpen = true;
      replyChosen = s.reply === true;
      publishState = s.publish && typeof s.publish === 'object' ? publishFrom(s.publish) : null;
      openedNow = false;
      caughtLink = null;
      description = s.description ?? '';
      coordsText = s.coordsText ?? '';
      place = s.place ?? '';
      mention = s.mention ?? prefs.postMention;
      source = s.source ?? '';
      date = typeof s.date === 'string' ? s.date : '';
      proofUndated = false;
      credits = typeof s.credits === 'string' ? s.credits : '';
      timecodeText = typeof s.timecode === 'string' ? s.timecode : '';
      timecodeKnown = !!timecodeText;
      setProof(s.proofPng ?? null);
      mediaEnabled = s.mediaEnabled ?? true;
      mediaType = s.mediaType ?? 'none';
      mediaText = mediaType === 'none'
        ? ''
        : s.mediaTextIncludesPrefix
          ? String(s.mediaText ?? '')
          : mediaTweetText(mediaType, s.mediaText ?? '', 2);
      mediaPaths = Array.isArray(s.mediaPaths)
        ? s.mediaPaths.filter((path) => typeof path === 'string').slice(0, MAX_POST_MEDIA)
        : (s.mediaPath ? [s.mediaPath] : []);
      body = typeof s.body === 'string' && s.body ? s.body : DEFAULT_TWEET_BODY;
      extraTweets = (s.extraTweets ?? []).map((t, i) => {
        const type = t.mediaType ?? 'none';
        const hasPrefix = t.mediaTextIncludesPrefix === true;
        const isMediaTweet = t.isMediaTweet === true || type !== 'none';
        return {
          id: ++extraSeq,
          text: type !== 'none' && !hasPrefix
            ? mediaTweetText(type, t.text ?? '', i + 3)
            : (t.text ?? ''),
          mediaPaths: Array.isArray(t.mediaPaths)
            ? t.mediaPaths.filter((path) => typeof path === 'string').slice(0, MAX_POST_MEDIA)
            : (typeof t.mediaPath === 'string' ? [t.mediaPath] : []),
          mediaType: type,
          isMediaTweet,
          mediaTextIncludesPrefix: isMediaTweet || hasPrefix,
          ...(thread && typeof t.key === 'string' ? { key: t.key, edited: t.edited === true } : {}),
        };
      });
      // the pictures' texts it keeps, with its box on when it keeps one
      const keptAlt = readAltRecord(s.alt);
      altTexts = keptAlt ?? {};
      altOn = !!keptAlt || prefs.postAltText;
      altSeen = new Set(keptAlt ? altPictures : []);
      draftName = name;
      settlePlace('post', where(), { navigate: true });
      postTitle = doc.title || name;
      postName = ownName(postTitle, 'draft');
      appliedPostTemplate = null;
      // restore geo facts from the coordinates, then honor any manual tweet edits
      if (s.coordsText?.trim()) {
        try {
          geo = await api.post('/api/geo/parse', { text: s.coordsText });
        } catch {
          geo = null;
        }
      } else {
        geo = null;
      }
      if (run !== postRun) return;
      tweet1 = s.tweet1 ?? buildTweet1();
      tweet1Edited = s.tweet1Edited ?? false;
      target = normalizePostTarget(s.target);
      // marked posted from its card before it was ever opened here: the post as it
      // stands is the one that went out
      if (publishState && !publishState.mark) publishState = { ...publishState, mark: postPrint() };
      // a post that keeps no text opens with its first words, as part of the post opened
      if (altOn) await prefillAlt(run);
      if (run !== postRun) return;
      openList = null;
      // as it was saved: opening it writes nothing
      blankKey = contentKey();
      writtenKey = saveKey(snapshot(), postTitle.trim());
      // a thread's places read again, for what it lays out next: its posts stay as saved
      if (thread?.video) {
        const caseId = caseState.current.id;
        readThread(caseId, thread.video).then((read) => {
          if (read && run === postRun && thread) Object.assign(thread, read);
        });
      }
    } catch (e) {
      toast(`Could not open the post: ${e.message}`, 'danger');
    } finally {
      if (run === postRun) opening = false;
    }
  }

  /**
   * A saved `publish` record as this build reads it, or null for a post that never went
   * out: what it does not know is left out, so a record an earlier build wrote on opening
   * the site (`opened_at`) and nothing more is a draft's.
   */
  function publishFrom(saved) {
    if (postState(saved) === 'draft') return null;
    const text = (value) => (typeof value === 'string' && value ? value : undefined);
    const found = postedAddress(saved.url);
    return Object.fromEntries(Object.entries({
      site: found?.site ?? (['x', 'bluesky'].includes(saved.site) ? saved.site : undefined),
      url: found?.url,
      posted_at: text(saved.posted_at),
      mark: text(saved.mark),
    }).filter(([, value]) => value !== undefined));
  }

  /** A blank post: Geolocation unless a start names another kind. */
  function resetDraft(next = 'geolocation') {
    kind = normalizePostKind(next);
    firstMedia = [];
    firstMediaType = 'none';
    thread = kind === 'video' ? newThread() : null;
    postOpen = false;
    replyChosen = false;
    beforeReply = null;
    publishState = null;
    openedNow = false;
    caughtLink = null;
    description = '';
    coordsText = '';
    geo = null;
    place = '';
    mention = prefs.postMention;
    source = '';
    date = '';
    proofUndated = false;
    credits = '';
    timecodeText = '';
    timecodeKnown = false;
    setProof(null);
    tweet1 = '';
    tweet1Edited = false;
    target = normalizePostTarget(prefs.postTarget);
    mediaEnabled = true;
    mediaType = 'none';
    mediaText = '';
    mediaPaths = [];
    body = DEFAULT_TWEET_BODY;
    extraTweets = [];
    altOn = prefs.postAltText;
    altTexts = {};
    altSeen = new Set();
    draftName = null;
    postTitle = freshPostName();
    postName = '';
    appliedPostTemplate = null;
    defaultDeclined = false;
    postRun += 1;
    opening = false;
    writtenKey = null;
    startFromDefaultTemplate();
    blankKey = contentKey();
  }

  // ---- what counts as work ---------------------------------------------------------
  // What a save would keep, to tell work from the post as it was opened or reset. The
  // platform follows Settings on a blank post, an untouched first post is rebuilt from
  // the fields and a numbered name is renumbered once the case's drafts are known, so
  // none of them counts as work on its own.
  function contentState() {
    const state = snapshot();
    delete state.target;
    delete state.tweet1;
    return { ...state, tweet1: tweet1Edited ? tweet1 : null };
  }
  function contentKey(state = contentState(), title = postTitle) {
    const named = String(title ?? '').trim();
    return JSON.stringify({ ...state, title: isDefaultName(named, 'draft') ? '' : named });
  }
  $effect(() => {
    if (blankKey === null) untrack(() => (blankKey = contentKey()));
  });

  /**
   * Before the post on screen makes way (another draft, Back, the home, New post):
   * what is pending is written and waited for. A post whose save failed stays open,
   * where the header says so and offers Retry, rather than be dropped.
   */
  async function letGo() {
    await tick(); // a change made a moment ago reaches the autosave first
    await autosave.flush();
    if (!autosave.unsaved) return true;
    toast('The post could not be saved, so it stays open', 'warn');
    return false;
  }
  async function requestLoadDraft(name) {
    if (await letGo()) await loadDraft(name);
  }

  // Where the composer is, in the address: the saved draft open, or none. Opening a
  // draft and going home are the steps Back retraces; a save naming it, a rename or a
  // discard only rewrite the step it is on.
  const where = () => ({ draft: draftName });
  $effect(() => settlePlace('post', where()));
  onDestroy(onBackForward('post', async (to) => {
    const target = to.draft ?? null;
    if (target === draftName) return true;
    if (!(await letGo())) return false;
    if (target) await loadDraft(target);
    else resetDraft();
    return true;
  }));
  // only a save that failed holds anything the page could lose
  onDestroy(holdsUnsaved('post', () => autosave.unsaved));

  const hasContent = $derived(
    !!(draftName || description.trim() || coordsText.trim() || date.trim() || credits.trim() || mediaPaths.length ||
      proofPng || extraTweets.length || tweet1.trim() || firstMedia.length)
  );

  // The home stands where an empty composer would, while the case has something to list.
  const homeShown = $derived(homeAvailable && !postOpen && !hasContent);

  // Preferences can arrive after this tool mounts. A blank composer follows the
  // preferred platform, while a selected or saved draft keeps its own target.
  $effect(() => {
    if (!hasContent) target = normalizePostTarget(prefs.postTarget);
  });
  $effect(() => {
    if (!hasContent) altOn = prefs.postAltText;
  });

  // Templates and preferences can land after this tool mounts, so a blank
  // composer picks the default template up when they do.
  $effect(() => {
    if (hasContent || appliedPostTemplate || defaultDeclined) return;
    const t = defaultTemplate();
    if (t) {
      untrack(() => {
        applyPostTemplate(t, { quiet: true });
        blankKey = contentKey();
      });
    }
  });

  // The live draft, mirrored for Settings → Templates so a layout can be tried on
  // the post that is open. Content only, and nothing while the composer is empty.
  $effect(() => {
    postDraftState.fields = hasContent
      ? {
        place, plusCode: geo?.plus_code, description, lat: geo?.lat, lon: geo?.lon,
        coordsText, mention, source, date, credits, video: postVideoTitle, timecode: timecodeText, kind,
      }
      : null;
    return () => (postDraftState.fields = null);
  });

  function reportAttachmentPaths() {
    return [
      proofPng,
      ...firstMedia,
      ...mediaPaths,
      ...extraTweets.flatMap((tweet) => tweet.mediaPaths),
    ].filter(Boolean);
  }

  async function reportEntities() {
    if (!caseState.current) return { proofEntity: null, mediaEntities: [] };
    const paths = [...new Set(reportAttachmentPaths())];
    const resolved = await Promise.all(paths.map(async (path) => {
      try {
        return [path, await lookupEntity(caseState.current.id, 'path', path)];
      } catch {
        return [path, null];
      }
    }));
    const byPath = new Map(resolved.filter(([, entity]) => entity));
    return {
      proofEntity: proofPng ? byPath.get(proofPng) ?? null : null,
      mediaEntities: paths
        .filter((path) => path !== proofPng)
        .map((path) => byPath.get(path))
        .filter(Boolean),
    };
  }

  function reportContent(title = draftTitle(), evidence = {}) {
    const points = pointLines(coordsText);
    const coordinates = geo
      ? `${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`
      : points[0]?.coords ?? '';
    return postReportMarkdown({
      title,
      place,
      plusCode: geo?.plus_code,
      coordinates,
      points,
      dms: geo?.dms,
      mapLinks: Object.fromEntries(geoLinks.map((link) => [link.label, link.url])),
      description,
      source,
      attachments: reportAttachmentPaths(),
      posted: liveState !== 'draft' ? { url: publishState.url ?? null, site: publishState.site, at: publishState.posted_at } : null,
      ...evidence,
    });
  }

  function openSaveReport() {
    if (!caseState.current) {
      toast('Open a case to add the post to its notes', 'warn');
      return;
    }
    reportModal = { title: draftTitle(), folder: '' };
  }

  async function saveReport() {
    if (!reportModal || !caseState.current) return;
    if (!reportModal.title.trim()) {
      toast('Title required', 'warn');
      return;
    }
    reportSaving = true;
    try {
      const evidence = await reportEntities();
      const note = await createNote(caseState.current.id, {
        title: reportModal.title,
        folder: reportModal.folder,
        content: reportContent(reportModal.title.trim(), evidence),
        // What the report was written from: the proof and media it embeds, and the
        // draft it was composed in when that draft is saved. The note reads as a
        // page of case files, so the graph has to say which ones — otherwise
        // deleting a proof leaves a dead image nothing accounted for.
        sources: [
          ...reportAttachmentPaths(),
          ...(draftName ? [specPath('draft', draftName)] : []),
        ],
      });
      await reloadCase();
      reportModal = null;
      toast('Added to notes', 'ok', 6000, {
        label: 'OPEN',
        onClick: () => openNotebook(note.id),
      });
    } catch (error) {
      toast(`Not added to notes: ${error.message}`, 'danger');
    } finally {
      reportSaving = false;
    }
  }

  // ---- publish handoff (Azimut never posts on the analyst's behalf) --------

  /**
   * The thread as the extension receives it: what to type, and which case files
   * to attach to each post. Paths only — the extension reads the bytes from the
   * app with its own pairing token, so no case file passes through the page.
   */
  function handoffPayload(firstText = tweet1) {
    const handed = handoffThread([
      { text: bidiSafe(firstText), files: firstFiles() },
      ...(mediaEnabled && mediaType !== 'none'
        ? [{ text: bidiSafe(tweet2Text()), files: mediaPaths }]
        : []),
      ...extraTweets.map((tweet, i) => ({
        text: bidiSafe(extraTweetText(tweet, i + 3)),
        files: tweet.mediaPaths,
      })),
    ]);
    // each picture's text beside its file, while the box is on
    return altOn ? { ...handed, posts: withAltTexts(handed.posts, altRecord(altTexts, altPictures) ?? {}) } : handed;
  }

  /**
   * Why the extension did not take the thread, in a sentence the analyst can act
   * on — or null when there is nothing they could do about it.
   *
   * The switch is on and an extension is installed, so **the difference between
   * "it filled the composer" and "it didn't" has to be visible**: a Publish that
   * quietly does the old thing looks like a broken button, and the two reasons it
   * is usually the old thing — an extension older than the app, or one never
   * paired — are both one click away from fixed. Silence is kept for the case
   * that is not: an extension that answered something else.
   */
  function handOffExcuse(error) {
    const installed = extensionVersion();
    if (/did not answer/.test(error.message)) {
      // A build that predates this feature has no route for the message and says
      // nothing at all, which is what the short timeout is really detecting.
      return extensionOutdated(installed, updatesState.extensionBundled)
        ? 'Your capture extension is older than Azimut. Reinstall it from Settings → Capture extension to fill the composer.'
        : null;
    }
    return /paired/.test(error.message) ? `Composer not filled: ${error.message}.` : null;
  }

  /**
   * Let the extension open the composer and fill the thread, if it can.
   *
   * True when it took the hand-off — the tab is open and the app has nothing left
   * to do. False for every other case: no extension, switched off, not permitted
   * on that site, a target it cannot fill. The caller opens the intent page
   * exactly as it always did, so the feature can only ever be a layer over the
   * working path, never a step in front of it.
   */
  async function tryHandOff() {
    if (!prefs.postPrefill || !extensionVersion()) return false;
    const url = postHandoffUrl(target, bidiSafe(tweet1));
    if (!url || !caseState.current) return false;
    const { posts, dropped } = handoffPayload();
    if (!posts.length) return false;
    try {
      // written first, so the draft the extension names exists when it reports on it
      await flushForHandOff();
      await handOffPost({ url, caseId: caseState.current.id, posts, draft: draftName });
      markOpened();
      // What it manages is the extension's to report — it is still filling while
      // this runs. What is said here is what is already true.
      const left = dropped ? ` ${dropped} file${dropped > 1 ? 's' : ''} over the per-post limit stayed behind.` : '';
      toast(`${targetInfo.label} is opening with the thread.${left} Nothing was posted.`, 'info', 4200);
      return true;
    } catch (e) {
      const excuse = handOffExcuse(e);
      if (excuse) toast(excuse, 'warn', 6000);
      return false;
    }
  }

  /** What is pending is written before a hand-off, a change made a moment ago included. */
  async function flushForHandOff() {
    await tick();
    await autosave.flush();
  }

  /** The files on the first post: a geolocation's proof, or any other kind's own media. */
  function firstFiles() {
    if (kind !== 'geolocation') return firstMedia;
    return proofPng ? [proofPng] : [];
  }

  let publishing = $state(false);

  // ---- reply under the source --------------------------------------------------
  // A geolocation whose source line is an X or a Bluesky post can go out as a reply
  // under it: one box under the source says so, and the main action becomes Reply
  // under the source. Its first post leaves the line naming the source, shown so in
  // the post, since it sits right under it; a link typed back in goes out as typed. A
  // template can start its posts replying (`reply`), and the draft keeps the choice.
  // Nothing is posted: the reply box opens filled.
  const replyTo = $derived(geolocation ? replyTarget(source) : null);
  const replySite = $derived(replyTo ? postTarget(replyTo.site).label : '');
  let replyChosen = $state(false);
  const replying = $derived(!!replyTo && replyChosen);
  // A rewritten post loses its source lines on the way into a reply, and gets them back
  // on the way out while it was not touched in between.
  let beforeReply = null; // { text, reply }
  let replyDialog = $state(false);
  const pasteKeys = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '') ? '⌘V' : 'Ctrl+V';

  function setReplying(on) {
    replyChosen = on;
    if (!tweet1.trim()) return;
    if (!tweet1Edited) {
      regenerate();
      return;
    }
    if (on) {
      const text = replyPostText({ text: tweet1, edited: true, body, fields: tokenFields() });
      beforeReply = { text: tweet1, reply: text };
      tweet1 = text;
    } else if (beforeReply && beforeReply.reply === tweet1) {
      tweet1 = beforeReply.text;
    }
    if (!on) beforeReply = null;
  }

  /**
   * Hand the reply to the extension: it opens the source post, presses its reply and
   * fills the thread there. Only an extension as new as the app knows a reply; an
   * older one would open a new post, so the app keeps the reply for itself then.
   */
  async function tryReplyHandOff(text) {
    const installed = extensionVersion();
    if (!prefs.postPrefill || !installed || !caseState.current || !replyTo) return false;
    if (extensionOutdated(installed, updatesState.extensionBundled)) return false;
    const { posts, dropped } = handoffPayload(text);
    if (!posts.length) return false;
    try {
      await flushForHandOff();
      await handOffPost({ url: replyTo.url, caseId: caseState.current.id, posts, reply_to: replyTo.url, draft: draftName });
      markOpened();
      const left = dropped ? ` ${dropped} file${dropped > 1 ? 's' : ''} over the per-post limit stayed behind.` : '';
      toast(`${replySite} is opening the reply under the source.${left} Nothing was posted.`, 'info', 4200);
      return true;
    } catch (e) {
      const excuse = handOffExcuse(e);
      if (excuse) toast(excuse, 'warn', 6000);
      return false;
    }
  }

  async function replyUnderSource() {
    if (publishing || !replyTo) return;
    publishing = true;
    try {
      const text = bidiSafe(tweet1);
      await copyAll(false);
      if (await tryReplyHandOff(text)) return;
      if (replyTo.site !== 'x') {
        // Bluesky has no page that opens a reply with words in it
        replyDialog = true;
        return;
      }
      // X's reply page takes the words. The proof goes on the clipboard, as Copy image
      // puts it there, for one paste in the box; the copy is made first, while this
      // tab still has the focus a clipboard asks for.
      let pictured = false;
      if (proofHref) {
        try {
          await putImageOnClipboard(proofHref);
          pictured = true;
        } catch {
          /* the reply still opens; the picture is one Copy image away */
        }
      }
      window.open(replyIntentUrl(replyTo.id, text), '_blank', 'noopener,noreferrer');
      markOpened();
      const more = threadParts(text).length > 1 ? ' The next posts are here to copy.' : '';
      toast(
        pictured ? `Picture copied: paste it with ${pasteKeys}.${more}` : `Opened ${replySite} under the source post.${more}`,
        'info',
        5200,
      );
    } finally {
      publishing = false;
    }
  }

  /** Bluesky without the extension: the reply copied, and the source post opened to paste it under. */
  async function copyReplyAndOpen() {
    replyDialog = false;
    await copyText(bidiSafe(tweet1), { said: 'Post copied' });
    if (replyTo) {
      window.open(replyTo.url, '_blank', 'noopener,noreferrer');
      markOpened();
    }
  }

  // ---- the extension window ------------------------------------------------------
  // Arriving in Post without the capture extension, a window says once why it is worth
  // having here. Not now puts it away in this browser (post/extensionWindow.js), and the
  // header then keeps a quiet line while it is still missing. It never stands in front
  // of the welcome, the tour or the guide, and Copy and Publish work without it.
  let extensionWindow = $state(false);
  let extensionWindowSaid = false;
  let windowPutAway = $state(extensionWindowPutAway());
  // read once: the bridge marks the page before the app mounts (lib/extBridge.js)
  const extensionMissing = globalThis.document ? !extensionVersion() : true;

  $effect(() => {
    if (uiState.tool !== 'post' || uiState.onboarding || uiState.guide) return;
    untrack(() => {
      if (extensionWindowSaid || windowPutAway || !extensionMissing) return;
      extensionWindowSaid = true;
      extensionWindow = true;
    });
  });

  function extensionLater() {
    putExtensionWindowAway();
    windowPutAway = true;
    extensionWindow = false;
  }

  function howToInstall() {
    extensionLater();
    replyDialog = false;
    openGuide('extension');
  }

  // ---- a header that fits ---------------------------------------------------------
  // What the header holds changes its width: the way back, the quiet line, a reply.
  // Each time, it is laid out whole first and measured, and only what overflows gives
  // way, a step at a time: first the name field narrows and the quiet line and Reply
  // say less (`narrow`), then the secondary buttons fold to their icons (`compact`),
  // as Geo Proof's do, then the quiet line keeps its Install, the kind its icon and
  // Publish its verb (`tight`), then Saved keeps its tick and the name field narrows
  // again (`savedBare`), so Mark as posted keeps its words longest, and last Mark as
  // posted (or its pill) keeps its icon (`tightest`), so a laptop with the case panel
  // open still shows Publish whole. Each opens again once the header is as wide as it
  // needed, all of it before the frame is drawn.
  let headerEl = $state(null);
  let headerW = $state(0);
  let fold = $state(0); // 0 whole, 1 narrow, 2 compact, 3 tight, 4 savedBare, 5 tightest
  const narrow = $derived(fold >= 1);
  const compact = $derived(fold >= 2);
  const tight = $derived(fold >= 3);
  const savedBare = $derived(fold >= 4);
  const tightest = $derived(fold >= 5);
  const LAST_FOLD = 5;
  let needs = [0, 0, 0, 0, 0];
  const headerHolds = $derived([
    homeShown, homeAvailable, hasContent, replying, windowPutAway && extensionMissing, saveStatus,
    kind, !!draftName, targetInfo.label, !!caseState.current, liveState, postedOnDay, caughtLink?.url ?? '',
  ].join('|'));

  /** The width the header needs as laid out now: what scrolls, or what eats its right padding. */
  function headerNeeds() {
    const box = headerEl.getBoundingClientRect();
    const end = headerEl.lastElementChild?.getBoundingClientRect().right ?? box.right;
    const pad = Number.parseFloat(getComputedStyle(headerEl).paddingRight) || 0;
    return headerEl.clientWidth + Math.max(headerEl.scrollWidth - headerEl.clientWidth, end - (box.right - pad), 0);
  }

  function fitHeader() {
    if (!headerEl) return;
    const need = headerNeeds();
    if (fold < LAST_FOLD && need > headerEl.clientWidth + 1) {
      needs[fold] = need;
      fold += 1;
      tick().then(fitHeader);
    } else if (fold > 0 && headerEl.clientWidth >= needs[fold - 1]) {
      fold -= 1;
      tick().then(fitHeader);
    }
  }
  $effect(() => {
    void headerHolds;
    untrack(() => {
      fold = 0;
      needs = [0, 0, 0, 0, 0];
      tick().then(fitHeader);
    });
  });
  $effect(() => {
    void headerW;
    untrack(fitHeader);
  });

  // ---- the home and New post -------------------------------------------------------
  let galleryOpen = $state(false);

  /** New post: the gallery of starts, once the post on screen may make way. */
  async function openGallery() {
    if (!(await letGo())) return;
    galleryOpen = true;
  }

  /** A start picked: the same road a To Post from another tool takes (`post/start.js`). */
  function pickStart(wanted) {
    galleryOpen = false;
    // a video thread asks which video first
    if (wanted === 'video') {
      videoPickerOpen = true;
      return;
    }
    // what was on screen was let go when New post was pressed
    resetDraft();
    startPost(wanted);
  }

  /** A video picked for its thread: the road every start takes. */
  function pickThreadVideo(video) {
    videoPickerOpen = false;
    startPost('video', [video]);
  }

  /** A proof waiting on the home: its geolocation post, as Attach a proof writes it. */
  async function postProofFromHome(row) {
    beginPost('geolocation');
    await pickProof(row);
  }

  /**
   * Mark as posted… on a waiting proof: the same post, then the header's popover, once the
   * proof has filled it in, so the post is marked as it went out.
   */
  async function postedFromHome(row) {
    await postProofFromHome(row);
    await tick();
    postedControl?.ask();
  }

  /** Open the proof: in Geo Proof, as every other tool opens one. */
  function openProofInGeoProof(name) {
    if (!name) return;
    uiState.openProof = name;
    uiState.tool = 'proof';
  }

  async function openFromHome(draft) {
    await requestLoadDraft(draft.name);
  }

  /**
   * Back to the home, once what is pending is written. It is a step Back retraces, as in
   * Geo Proof, so the browser's Back from the home opens the post again.
   */
  async function backToHome() {
    if (!(await letGo())) return;
    resetDraft();
    settlePlace('post', where(), { navigate: true });
  }

  async function publish() {
    if (publishing) return;
    publishing = true;
    try {
      // Social intents prefill the first post only. The rest is copied as replies, and a
      // clipboard the browser keeps shut costs the replies, never the hand-off itself.
      const copied = await copyAll(false);
      // a thread's recap goes with its map, made first, or nothing is opened
      const making = mapPending;
      if (!(await readyRecapMap(`The recap map could not be made, so ${targetInfo.label} was not opened.`))) return;
      if (await tryHandOff()) return;
      const url = postComposeUrl(target, bidiSafe(tweet1));
      // the browser may no longer let the page open a tab once the map is made
      if (making && globalThis.navigator?.userActivation?.isActive === false) {
        toast(`The recap map is made. Open ${targetInfo.label} to post.`, 'info', 0,
          { label: `Open ${targetInfo.label}`, onClick: () => openCompose(url, copied) });
        return;
      }
      openCompose(url, copied);
    } finally {
      publishing = false;
    }
  }

  /** The platform's composer opened in a tab, its first post in it. */
  function openCompose(url, copied) {
    window.open(url, '_blank', 'noopener,noreferrer');
    markOpened();
    toast(
      copied ? `Opened ${targetInfo.label}. Posts copied for replies.` : `Opened ${targetInfo.label}. Copy the replies from here.`,
      'info',
      3200,
    );
  }
</script>

<svelte:window {onpagehide} />

<div class="tool">
  <!-- Narrower than what it holds (the case panel open on a laptop, a reply beside
       Publish), the header shows its secondary buttons as icons rather than cut off
       Publish, as Geo Proof's does. Wide enough, it is the header it always was. -->
  <div class="tool-header" class:narrow class:compact class:tight class:saved-bare={savedBare} bind:this={headerEl} bind:clientWidth={headerW}>
    {#if !homeShown}
      <!-- the way back to the posts of the case, once it has some to list -->
      {#if homeAvailable}
        <BackButton label="Posts" title="Back to the posts of this case" onclick={backToHome} guide="post.home" />
      {/if}
      {#if caseState.current}
        <input class="input title-input" bind:value={postName} onblur={commitName} onkeydown={nameKey}
          maxlength="200" aria-label="Post name" placeholder="Name (optional)"
          title="Name the post. Left empty, it is listed by its place and date" />
        {#if draftName}
          <button class="btn btn-ghost btn-sm post-more" aria-label="More for this post" title="More for this post"
            aria-haspopup="menu" aria-expanded={!!postMenu} onclick={(event) => (postMenu = postMenu ? null : event.currentTarget)}>
            <Icon name="more" size={14} stroke={2.4} />
          </button>
        {/if}
        {#if saveStatus === 'saving'}
          <span class="save-status">Saving…</span>
        {:else if saveStatus === 'saved'}
          <span class="save-status" class:bare={savedBare}
            title={savedBare ? 'Saved: this post saves itself as you write' : 'This post saves itself as you write'}>
            <Icon name="check" size={12} /><span class="saved-word">Saved</span></span>
        {:else if saveStatus === 'error'}
          <span class="save-status error" title={autosave.state.error}><Icon name="alert" size={12} /> Not saved</span>
          <button class="btn btn-ghost btn-xs" onclick={() => autosave.flush()}>Retry</button>
        {/if}
        <!-- where it stands, and the one place to say it went out -->
        <PostedControl bind:this={postedControl} standing={liveState} url={publishState?.url ?? null} day={postedOnDay}
          accent={openedNow} iconOnly={tightest} proposal={caughtLink}
          onmark={markPosted} onunmark={unmarkPosted}
          onkeep={() => markPosted(caughtLink.url)} ondismiss={() => (caughtLink = null)} />
      {/if}
      {#if !geolocation}
        <span class="kind-chip" title={tight ? postKind(kind).label : 'What this post is made from'}><Icon name={postKind(kind).icon} size={12} />{#if !tight}{postKind(kind).label}{/if}</span>
      {/if}
    {/if}
    <div class="head-actions">
      {#if windowPutAway && extensionMissing}
        <span class="ext-quiet" title="The capture extension fills the thread in the site's composer">
          {#if !tight}{narrow ? 'No extension' : 'Extension not connected'}{' · '}{/if}<button type="button" class="ext-install" onclick={howToInstall}>Install</button>
        </span>
      {/if}
      {#if caseState.current && !homeShown}
        <button class="btn btn-sm add-notes" data-guide="post.report" onclick={openSaveReport} disabled={!hasContent}
          aria-label="Add to notes" title="Add to notes">
          <Icon name="note" size={14} />
        </button>
      {/if}
      {#if caseState.current}
        <button class="btn btn-sm" onclick={openDraftList} title="Open a post of this case">
          <Icon name="folderOpen" size={14} /> <span class="words">Open</span>
        </button>
      {/if}
      {#if homeShown}
        <button class="btn btn-sm" data-guide="post.new" onclick={openGallery} title="Start a post: a geolocation, a map plate, a comparison or your own words">
          <Icon name="plus" size={14} /> New post
        </button>
      {:else}
        {#if replying}
          <!-- the main action, while the post goes out under its source -->
          <button class="btn btn-info btn-sm" data-guide="post.publish" onclick={replyUnderSource} disabled={!tweet1.trim() || publishing}
            aria-label="Reply under the source" title={`Open the reply box under the source post on ${replySite}`}>
            <Icon name="undo" size={14} /> {narrow ? 'Reply' : 'Reply under the source'}
          </button>
        {:else}
          <button class="btn btn-info btn-sm" data-guide="post.publish" onclick={publish} disabled={!tweet1.trim() || publishing} title={`Copy posts and open ${targetInfo.label}`}
            aria-label={`Publish on ${targetInfo.label}`}>
            <Icon name="post" size={14} /> {tight ? 'Publish' : `Publish on ${targetInfo.label}`}
          </button>
        {/if}
      {/if}
    </div>
  </div>

  {#if postMenu && draftName}
    <FloatingMenu anchor={postMenu} width={200} label="This post" onclose={() => (postMenu = null)}>
      <button type="button" class="fm-item danger" title="Send it to the Trash, from where it can be restored"
        onclick={() => { postMenu = null; askDelete({ name: draftName, title: draftTitle(), proof: geolocation ? proofPng : null }); }}>
        <Icon name="trash" size={14} /><span class="fm-grow">Delete…</span></button>
    </FloatingMenu>
  {/if}

  {#if homeShown}
  <div class="tool-body home-body">
    <PostHome caseId={caseState.current?.id ?? ''} drafts={caseDrafts} proofs={caseProofs} media={mediaByPath}
      onnew={openGallery} onopen={openFromHome} onall={openDraftList} onproof={postProofFromHome} onposted={postedFromHome}
      onthread={(series) => startPost('video', [series.video])}
      onmark={(draft, url) => markSavedPost(draft, url)} onunmark={(draft) => markSavedPost(draft, null, { posted: false })}
      ondelete={askDelete} onproofopen={openProofInGeoProof} />
  </div>
  {:else}
  <div class="tool-body">
    <div class="layout">
      <!-- left column: ingredients -->
      <div class="col" data-guide="post.ingredients">
        <div class="field">
          <span class="label">Publish target</span>
          <div class="target-tabs" aria-label="Publish target">
            {#each Object.values(POST_TARGETS) as option (option.id)}
              <button
                class="btn btn-sm"
                class:btn-primary={target === option.id}
                class:btn-ghost={target !== option.id}
                onclick={() => (target = option.id)}
              >{option.label}</button>
            {/each}
          </div>
        </div>

        <!-- Thread style: apply a saved structure (mention, layout, media flag,
             boilerplate tweets) over this draft. "Discard" returns to the
             structure the draft had before. -->
        <div class="field">
          <div class="style-head">
            <label class="label" for="pc-tpl">Thread style</label>
            {#if templatesState.post.length || builtInLayouts.length}
              <button
                class="tpl-settings-link"
                type="button"
                title="Manage thread templates in Settings"
                onclick={openTemplateSettings}
              >
                Settings templates
              </button>
            {/if}
          </div>
          {#if appliedPostTemplate}
            <div class="tpl-loaded" title={`Template loaded: ${appliedPostTemplate.name}`}>
              <span class="tpl-loaded-name">
                <Icon name="check" size={12} /> {appliedPostTemplate.name}
              </span>
              <button class="tpl-remove" title="Remove this template" onclick={discardPostTemplate} aria-label="Remove template">
                <Icon name="x" size={12} />
              </button>
            </div>
          {:else if kindTemplates.length || builtInLayouts.length}
            <select id="pc-tpl" class="input" onchange={applyPostFromSelect}>
              <option value="">Apply a template…</option>
              {#each kindTemplates as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
              {#if builtInLayouts.length}
                <optgroup label="Built-in">
                  {#each builtInLayouts as starter (starter.id)}
                    <option value={`${BUILT_IN}${starter.id}`}>{starter.label}</option>
                  {/each}
                </optgroup>
              {/if}
            </select>
          {:else}
            <p class="tpl-none">
              No templates yet.
              <button
                class="tpl-inline-link"
                type="button"
                title="Create a thread template in Settings"
                onclick={openTemplateSettings}
              >
                Create one in Settings → Templates.
              </button>
            </p>
          {/if}
        </div>

        {#if thread}
          <!-- the video, its places, the order, and what goes when the video is too long -->
          <div class="field">
            {#snippet recapPicture()}
              <RecapMap slides={thread.slides} recap={thread.recap} options={thread.mapOptions} live={thread.mapLive}
                onrecap={setRecap} onoptions={setMapOptions} onlive={() => (thread.mapLive = true)} />
            {/snippet}
            <VideoThreadPanel title={thread.video ? videoName(thread.video, titleByPath.get(thread.video)) : ''}
              threadTitle={threadTitle()} ontitle={setThreadTitle} recap={recapPicture}
              places={thread.slides} left={thread.left} cut={thread.cut} order={thread.order} onorder={setThreadOrder}
              sheet={thread.sheetState} onsheet={fileSheetIfShown} over={threadOver} clip={thread.clip} link={thread.link}
              href={source.trim()} onclip={setThreadClip} onlink={setThreadLink} />
          </div>
        {:else}
        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('description')}
          title={fieldDisabledByTemplate('description') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-desc">Description</label>
          <input
            id="pc-desc"
            class="input"
            placeholder="A formation of 13 helicopters was spotted heading East"
            bind:value={description}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('description')}
          />
        </div>
        {/if}

        {#if !thread && templateUsesPostField(body, 'date')}
          <div class="field">
            <label class="label" for="pc-date">Date</label>
            <input
              id="pc-date"
              class="input"
              placeholder="2025-10-24 14:30 UTC+3"
              bind:value={date}
              oninput={() => (proofUndated = false)}
              onchange={regenerate}
            />
            {#if proofUndated && !date.trim()}
              <p class="field-note">This proof has no date. Leave it empty and the line drops.</p>
            {:else if dateNote}
              <p class="field-note">{dateNote}</p>
            {/if}
          </div>
        {/if}

        {#if templateUsesPostField(body, 'credits')}
          <div class="field">
            <label class="label" for="pc-credits">Credits</label>
            <input
              id="pc-credits"
              class="input"
              placeholder="Imagery: Copernicus Sentinel-2"
              bind:value={credits}
              onchange={regenerate}
            />
          </div>
        {/if}

        {#if geolocation && timecodeKnown && templateUsesPostField(body, 'timecode')}
          <div class="field">
            <label class="label" for="pc-timecode">Timecode</label>
            <input id="pc-timecode" class="input mono" placeholder="[0:00–0:07]" title="The time the proof states in its video"
              bind:value={timecodeText} onchange={regenerate} />
          </div>
        {/if}

        {#if fieldShown('coordinates')}
        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('coordinates')}
          title={fieldDisabledByTemplate('coordinates') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-coords">Coordinates</label>
          <!-- One point per line. A proof showing three impacts hands over three,
               and the first one is what the facts below are an address for. -->
          <textarea
            id="pc-coords"
            class="input mono coords-input"
            rows={Math.min(4, Math.max(1, pointLines(coordsText).length))}
            placeholder="10.303315, -66.874095"
            bind:value={coordsText}
            onchange={resolveCoords}
            disabled={fieldDisabledByTemplate('coordinates')}
          ></textarea>
          {#if geo}
            <div class="geo-facts card">
              <button class="fact mono" onclick={() => copy(`${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}`)} title="Copy">
                <Icon name="crosshair" size={12} /> {geo.lat.toFixed(6)}, {geo.lon.toFixed(6)}
              </button>
              <button class="fact mono" onclick={() => copy(geo.dms)} title="Copy">
                <Icon name="globe" size={12} /> {geo.dms}
              </button>
              <button class="fact mono" onclick={() => copy(geo.plus_code)} title="Copy">
                <Icon name="hash" size={12} /> {geo.plus_code}
              </button>
              <div class="links">
                {#each geoLinks as link (link.id)}
                  <a href={link.url} target="_blank" rel="noreferrer" class="badge info">{link.label}</a>
                {/each}
              </div>
            </div>
          {/if}
        </div>
        {/if}

        {#if fieldShown('place')}
        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('place')}
          title={fieldDisabledByTemplate('place') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-place">
            Place {#if placeLoading}<span class="loading">resolving…</span>{/if}
          </label>
          <input
            id="pc-place"
            class="input"
            placeholder="Village, State, Country"
            bind:value={place}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('place')}
          />
        </div>
        {/if}

        {#if fieldShown('mention')}
        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('mention')}
          title={fieldDisabledByTemplate('mention') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-mention">Mention</label>
          <input
            id="pc-mention"
            class="input mono"
            placeholder="@GeoConfirmed"
            bind:value={mention}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('mention')}
          />
        </div>
        {/if}

        {#if fieldShown('source')}
        <div
          class="field"
          class:template-disabled={fieldDisabledByTemplate('source')}
          title={fieldDisabledByTemplate('source') ? TEMPLATE_FIELD_HINT : undefined}
        >
          <label class="label" for="pc-source">Source</label>
          <!-- A box of several lines: a proof read from a thread rests on the post that
               published it and the ones under it, and each address is a line. -->
          <textarea
            id="pc-source"
            class="textarea post-source"
            rows={sourceRows}
            placeholder="https://instagram.com/… (original post)"
            bind:value={source}
            onchange={regenerate}
            disabled={fieldDisabledByTemplate('source')}
          ></textarea>
        </div>
        {/if}

        {#if replyTo}
          <!-- Beside the source rather than inside its field, so a layout leaving the
               source out never greys it. -->
          <label class="reply-check" data-guide="post.reply"
            title={`The post goes out under the source post on ${replySite}, without the link to it`}>
            <input type="checkbox" checked={replyChosen} onchange={(event) => setReplying(event.currentTarget.checked)} />
            Post as a reply under the source
          </label>
        {/if}

      </div>

      <!-- right column: the thread -->
      <div class="col">

        <!-- Post 1: geolocation -->
        <!-- or the first post of another kind, carrying its own media -->
        <div class="tweet-block card" data-guide="post.first">
          <div class="tweet-head">
            <span class="tweet-num">1</span>
            <span class="label" style="margin:0">{geolocation ? 'Geolocation post' : thread?.first ? threadLabel(thread.first, firstMediaType) : 'First post'}</span>
            {#if tweet1Edited}
              <button class="btn btn-ghost btn-sm" onclick={() => (thread ? rewriteThread({ first: true }) : regenerate())} title="Rebuild from the fields">
                <Icon name="compass" size={13} /> regenerate
              </button>
            {/if}
            <span class="counter" class:over={tweet1Over} title={targetInfo.limitHelp}>{tweet1Count}/{targetInfo.limitLabel}</span>
            <button class="btn btn-ghost btn-sm" onclick={copyFirst} disabled={!tweet1.trim()}>
              <Icon name="copy" size={13} /> Copy
            </button>
          </div>
          <textarea
            class="textarea post-text mono"
            dir="auto"
            bind:value={tweet1}
            oninput={() => (tweet1Edited = true)}
            rows="11"
          ></textarea>
          <!-- The proof is this post's attachment, so it rides on this card the way
               every other post carries its media. Read across the column, the thread
               is what will be published, picture by picture. -->
          {#if caseState.current && mapPending}
            <!-- the recap's map, made when the thread needs its picture -->
            <div class="media-attach first-media" data-testid="recap-map-pending">
              {#if thread.mapState === 'making'}
                <span class="map-making" role="status"><Icon name="satellite" size={13} /> Making the map…</span>
              {:else}
                <span class="attach-chip" title="Made and filed in Media when you publish, copy or download the thread">
                  <Icon name="satellite" size={12} /> Recap map
                </span>
                <button class="btn btn-ghost btn-sm" onclick={downloadRecapMap} title="Make the map and download it">
                  <Icon name="download" size={13} /> Download
                </button>
              {/if}
            </div>
          {:else if caseState.current && !geolocation}
            <!-- its own pictures or video, chosen like any media post's -->
            <div class="media-attach first-media">
              <div class="media-tabs">
                <button class="btn btn-sm" class:btn-primary={firstMediaType === 'video'} class:btn-ghost={firstMediaType !== 'video'}
                  onclick={() => setFirstMediaType('video')}>Video</button>
                <button class="btn btn-sm" class:btn-primary={firstMediaType === 'images'} class:btn-ghost={firstMediaType !== 'images'}
                  onclick={() => setFirstMediaType('images')}>Image</button>
              </div>
              {#if firstMediaType !== 'none'}
                <button class="btn btn-ghost btn-sm" onclick={() => openPicker('first')}>
                  <Icon name="media" size={13} /> {firstMedia.length ? 'Edit media' : 'Add media'}
                </button>
              {/if}
              {#each firstMedia as path (path)}
                {@const href = mediaHref(path)}
                <span class="attach-chip">
                  <a href={href} target="_blank" rel="noreferrer" title={path}>{path.replace(/^media\//, '')}</a>
                  <button class="chip-x" onclick={() => clearFirstMedia(path)} title="Remove this media">
                    <Icon name="x" size={11} />
                  </button>
                </span>
                {#if firstMediaType === 'images'}
                  <button class="btn btn-ghost btn-sm" onclick={() => copyImage(href)} title="Copy this image">
                    <Icon name="copy" size={13} /> Copy image
                  </button>
                {/if}
              {/each}
              {#if firstMedia.length}
                <button class="btn btn-ghost btn-sm" onclick={() => downloadPostMedia(firstMedia)} title="Download this post's media">
                  <Icon name="download" size={13} /> {firstMedia.length > 1 ? `Download all (${firstMedia.length})` : 'Download'}
                </button>
              {/if}
              {#if altBoxAt === 'first'}<AltTextBox on={altOn} onchange={setAltOn} />{/if}
            </div>
            {#if firstMediaType === 'images' && firstMedia.length}
              <div class="first-pics">
                {#each firstMedia as path (path)}
                  <img src={mediaHref(path)} alt="" loading="lazy" />
                {/each}
              </div>
              {#if altOn}<AltTexts paths={firstMedia} texts={altTexts} {target} href={mediaHref} thumbs={firstMedia.length > 1} onedit={editAlt} oncopy={copyAlt} />{/if}
            {/if}
          {:else if caseState.current}
            <div class="media-attach">
              {#if proofPng}
                <span class="attach-chip">
                  <a href={proofHref} target="_blank" rel="noreferrer" title={proofPng}>
                    {proofPng.replace(/^proofs\//, '')}
                  </a>
                  <button class="chip-x" onclick={clearProof} title="Detach proof">
                    <Icon name="x" size={11} />
                  </button>
                </span>
                <button class="btn btn-ghost btn-sm" onclick={() => copyImage(proofHref)} title="Copy this image">
                  <Icon name="copy" size={13} /> Copy image
                </button>
                <button class="btn btn-ghost btn-sm" onclick={openProofPicker} title="Attach a different proof">
                  <Icon name="proof" size={13} /> Change
                </button>
              {:else}
                <button class="btn btn-ghost btn-sm" onclick={openProofPicker}>
                  <Icon name="proof" size={13} /> Attach a proof
                </button>
              {/if}
              {#if altBoxAt === 'first'}<AltTextBox on={altOn} onchange={setAltOn} />{/if}
            </div>
            {#if proofPng}
              <a href={proofHref} target="_blank" rel="noreferrer">
                <img class="proof-preview card" src={proofHref} alt="proof" />
              </a>
              {#if altOn}<AltTexts paths={[proofPng]} texts={altTexts} {target} href={mediaHref} thumbs={false} onedit={editAlt} oncopy={copyAlt} />{/if}
            {/if}
          {/if}
        </div>

        <!-- Post 2: media (Video / Image) -->
        {#if mediaEnabled}
        <div class="tweet-block card">
          <div class="tweet-head">
            <span class="tweet-num">2</span>
            <span class="label" style="margin:0">Media</span>
            <div class="media-tabs">
              <button
                class="btn btn-sm"
                class:btn-primary={mediaType === 'video'}
                class:btn-ghost={mediaType !== 'video'}
                onclick={() => setMediaType('video')}
              >Video</button>
              <button
                class="btn btn-sm"
                class:btn-primary={mediaType === 'images'}
                class:btn-ghost={mediaType !== 'images'}
                onclick={() => setMediaType('images')}
              >Image</button>
            </div>
            {#if mediaType !== 'none'}
              <span class="counter" class:over={targetLength(tweet2Text()) > targetInfo.limit} title={targetInfo.limitHelp}>{targetLength(tweet2Text())}/{targetInfo.limitLabel}</span>
              <button class="btn btn-ghost btn-sm" onclick={() => copy(tweet2Text())}>
                <Icon name="copy" size={13} /> Copy
              </button>
            {/if}
            <button class="btn btn-ghost btn-sm danger-hover" onclick={() => (mediaEnabled = false)} title="Remove media post">
              <Icon name="x" size={13} />
            </button>
          </div>
          {#if mediaType !== 'none'}
            <textarea
              class="textarea post-text mono"
              dir="auto"
              placeholder="Descriptions, captions, hashtags…"
              bind:value={mediaText}
              rows="3"
            ></textarea>
            <div class="media-attach">
              <button class="btn btn-ghost btn-sm" onclick={() => openPicker()}>
                <Icon name="media" size={13} /> Edit media
              </button>
              {#each mediaPaths as path (path)}
                {@const href = mediaHref(path)}
                {@const kind = mediaKind(path)}
                <span class="attach-chip">
                  {#if href}
                    <a href={href} target="_blank" rel="noreferrer" title={path}>
                      {path.replace(/^media\//, '')}
                    </a>
                  {:else}
                    {path.replace(/^media\//, '')}
                  {/if}
                  <button class="chip-x" onclick={() => clearMedia(path)} title="Remove this media">
                    <Icon name="x" size={11} />
                  </button>
                </span>
                {#if kind === 'image'}
                  <button class="btn btn-ghost btn-sm" onclick={() => copyImage(href)} title="Copy this image">
                    <Icon name="copy" size={13} /> Copy image
                  </button>
                {/if}
              {/each}
              {#if mediaPaths.length}
                <button class="btn btn-ghost btn-sm" onclick={() => downloadPostMedia(mediaPaths)} title="Download this post's media">
                  <Icon name="download" size={13} /> {mediaPaths.length > 1 ? `Download all (${mediaPaths.length})` : 'Download'}
                </button>
              {/if}
              {#if altBoxAt === 'media'}<AltTextBox on={altOn} onchange={setAltOn} />{/if}
            </div>
            {#if altOn && mediaType === 'images' && mediaPaths.length}<AltTexts paths={mediaPaths} texts={altTexts} {target} href={mediaHref} onedit={editAlt} oncopy={copyAlt} />{/if}
          {:else}
            <span class="muted">Choose Video or Image to add media.</span>
          {/if}
        </div>
        {/if}

        <!-- Extra context posts (3, 4, …) -->
        {#each extraTweets as tweet, i (tweet.id)}
          <div class="tweet-block card">
            <div class="tweet-head">
              <span class="tweet-num">{i + (mediaEnabled ? 3 : 2)}</span>
              <span class="label" style="margin:0">{tweet.key ? threadLabel(tweet.key, tweet.mediaType) : tweet.isMediaTweet || tweet.mediaType !== 'none' ? 'Media' : 'Context'}</span>
              {#if tweet.key && tweet.edited}
                <button class="btn btn-ghost btn-sm" onclick={() => rewritePost(tweet)} title="Rebuild from the fields">
                  <Icon name="compass" size={13} /> regenerate
                </button>
              {/if}
              {#if tweet.isMediaTweet || tweet.mediaPaths.length || tweet.mediaType !== 'none'}
                <div class="media-tabs">
                  <button class="btn btn-sm" class:btn-primary={tweet.mediaType === 'video'} class:btn-ghost={tweet.mediaType !== 'video'} onclick={() => setExtraMediaType(tweet, 'video')}>Video</button>
                  <button class="btn btn-sm" class:btn-primary={tweet.mediaType === 'images'} class:btn-ghost={tweet.mediaType !== 'images'} onclick={() => setExtraMediaType(tweet, 'images')}>Image</button>
                </div>
              {/if}
              <span class="counter" class:over={targetLength(extraTweetText(tweet, i + 3)) > targetInfo.limit} title={targetInfo.limitHelp}>
                {targetLength(extraTweetText(tweet, i + 3))}/{targetInfo.limitLabel}
              </span>
              <button class="btn btn-ghost btn-sm" onclick={() => copy(extraTweetText(tweet, i + 3))} disabled={!extraTweetText(tweet, i + 3)}>
                <Icon name="copy" size={13} /> Copy
              </button>
              <button class="btn btn-ghost btn-sm danger-hover" onclick={() => removeExtraTweet(tweet.id)} title="Remove post">
                <Icon name="x" size={13} />
              </button>
            </div>
            {#if tweet.isMediaTweet && tweet.mediaType === 'none'}
              <span class="muted">Choose Video or Image to add media.</span>
            {:else}
              <textarea
                class="textarea post-text mono"
                dir="auto"
                placeholder={tweet.mediaType !== 'none' ? 'Descriptions, captions, hashtags…' : 'Additional context…'}
                bind:value={tweet.text}
                oninput={() => { if (tweet.key) tweet.edited = true; }}
                rows={tweet.mediaType !== 'none' ? 3 : 4}
              ></textarea>
            {/if}
            {#if tweet.mediaPaths.length || tweet.mediaType !== 'none'}
              <div class="media-attach">
                <button class="btn btn-ghost btn-sm" onclick={() => openPicker(tweet.id)}>
                  <Icon name="media" size={13} /> Edit media
                </button>
                {#each tweet.mediaPaths as path (path)}
                  {@const href = mediaHref(path)}
                  <span class="attach-chip">
                    {#if href}
                      <a href={href} target="_blank" rel="noreferrer" title={path}>
                        {path.replace(/^media\//, '')}
                      </a>
                    {:else}
                      {path.replace(/^media\//, '')}
                    {/if}
                    <button class="chip-x" onclick={() => clearExtraMedia(tweet.id, path)} title="Remove this media">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                  {#if tweet.mediaType === 'images'}
                    <button class="btn btn-ghost btn-sm" onclick={() => copyImage(href)} title="Copy this image">
                      <Icon name="copy" size={13} /> Copy image
                    </button>
                  {/if}
                {/each}
                {#if tweet.mediaPaths.length}
                  <button class="btn btn-ghost btn-sm" onclick={() => downloadPostMedia(tweet.mediaPaths)} title="Download this post's media">
                    <Icon name="download" size={13} /> {tweet.mediaPaths.length > 1 ? `Download all (${tweet.mediaPaths.length})` : 'Download'}
                  </button>
                {/if}
                {#if altBoxAt === tweet.id}<AltTextBox on={altOn} onchange={setAltOn} />{/if}
              </div>
              {#if altOn && tweet.mediaType === 'images' && tweet.mediaPaths.length}<AltTexts paths={tweet.mediaPaths} texts={altTexts} {target} href={mediaHref} onedit={editAlt} oncopy={copyAlt} />{/if}
            {/if}
          </div>
        {/each}

        <div class="thread-actions" data-guide="post.more">
          <!-- a post of another kind starts with no media post under it, so its first
               one is post 2 itself rather than a post 2 "restored" -->
          {#if !mediaEnabled && geolocation}
            <button class="btn btn-ghost btn-sm" onclick={() => (mediaEnabled = true)}>
              <Icon name="plus" size={13} /> Restore post 2
            </button>
          {/if}
          <button class="btn btn-ghost btn-sm" onclick={() => (!mediaEnabled && !geolocation && !thread ? (mediaEnabled = true) : addMediaTweet())}>
            <Icon name="plus" size={13} /> Add media post
          </button>
          <button class="btn btn-ghost btn-sm" onclick={addExtraTweet}>
            <Icon name="plus" size={13} /> Add context post
          </button>
          <button class="btn btn-ghost btn-sm" onclick={copyAllPressed}>
            <Icon name="copy" size={13} /> Copy all
          </button>
        </div>

      </div>
    </div>
  </div>
  {/if}
</div>

{#if galleryOpen}
  <NewPostGallery onpick={pickStart} onclose={() => (galleryOpen = false)} />
{/if}

{#if videoPickerOpen}
  <VideoPicker caseId={caseState.current?.id ?? ''} proofs={caseProofs ?? openProofs} drafts={caseDrafts}
    onpick={pickThreadVideo} onclose={() => (videoPickerOpen = false)} />
{/if}

{#if extensionWindow}
  <ExtensionWindow oninstall={howToInstall} onlater={extensionLater} />
{/if}

{#if replyDialog}
  <ReplyDialog oncopy={copyReplyAndOpen} oninstall={howToInstall} onclose={() => (replyDialog = false)} />
{/if}

{#if reportModal}
  <Modal title="Add to notes" onclose={() => (reportModal = null)} width="580px">
    <p class="modal-lead">Writes this post into a new case note: its place, its source and its pictures. The post stays as it is.</p>
    <label class="modal-label" for="report-note-title">Note title</label>
    <input id="report-note-title" class="input" placeholder="Note title…" bind:value={reportModal.title} />

    <span class="modal-label" style="margin-top:10px">Folder</span>
    <FolderSelect bind:value={reportModal.folder} folders={caseState.current?.folders ?? []} emptyLabel="Unfiled" fresh />

    <div class="modal-row">
      <div style="flex:1"></div>
      <button class="btn" onclick={() => (reportModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveReport} disabled={reportSaving}>
        {reportSaving ? 'Adding…' : 'Add to notes'}
      </button>
    </div>
  </Modal>
{/if}

{#if openList}
  <PostOpenList caseId={caseState.current?.id ?? ''} drafts={openList} loading={openListLoading}
    proofs={caseProofs ?? openProofs} media={mediaByPath}
    onopen={(draft) => requestLoadDraft(draft.name)} ondelete={askDelete} onclose={() => (openList = null)} />
{/if}

{#if deleteEntry}
  <ConfirmDialog
    title="Delete this post?"
    message={`“${deleteEntry.title}” will be removed from the case.`}
    detail={deleteFreesProof ? 'Moves the post to the case trash. Its proof goes back to Ready to post.' : 'Moves the post to the case trash.'}
    impact={{ caseId: caseState.current?.id, named: [{ tool: 'draft', name: deleteEntry.name }] }}
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
    icon="trash"
    busy={deleting}
    onconfirm={deleteSavedDraft}
    oncancel={() => (deleteEntry = null)}
  />
{/if}

{#if pickerOpen}
  <Modal title={pickerTitle()} width="640px" onclose={() => (pickerOpen = false)}>
    {#if pickerItems().length === 0}
      <p class="picker-empty">No {pickerTweet()?.mediaType === 'video' ? 'videos' : 'images'} in this case.</p>
    {:else}
      {#if pickerItems().length > 6}
        <div class="picker-search">
          <SearchInput
            bind:value={pickerQuery}
            placeholder="Search media…"
            width="100%"
            count={pickerQuery.trim() ? `${visiblePickerItems().length} shown` : null}
          />
        </div>
      {/if}
      {#if visiblePickerItems().length === 0}
        <p class="picker-empty">No media matches “{pickerQuery.trim()}”.</p>
      {/if}
      <div class="picker-grid">
        {#each (caseState.current ? visiblePickerItems() : []) as item (item.path)}
          {@const selected = (pickerTweet()?.mediaPaths ?? []).includes(item.path)}
          <button
            class="picker-item"
            class:selected={selected}
            onclick={() => pickMedia(item)}
            title={item.path}
          >
            <div class="picker-thumb">
              {#if item.thumbnail}
                <img src={fileUrl(caseState.current.id, item.thumbnail)} alt={item.path} />
              {:else}
                <Icon name={item.kind === 'video' ? 'video' : item.kind === 'audio' ? 'audio' : 'file'} size={24} />
              {/if}
              {#if item.kind === 'video'}<span class="kind-badge"><Icon name="video" size={11} /></span>{/if}
              {#if selected}<span class="select-check"><Icon name="check" size={13} /></span>{/if}
            </div>
            <span class="picker-name">{(item.label || item.path).replace(/^media\//, '')}</span>
          </button>
        {/each}
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary btn-sm" onclick={() => (pickerOpen = false)}>Done</button>
      </div>
    {/if}
  </Modal>
{/if}

{#if proofPickerOpen}
  <Modal title="Attach a proof" width="640px" onclose={() => (proofPickerOpen = false)}>
    {#if proofLibrary.length === 0}
      <p class="picker-empty">No proofs in this case yet. Build one in the Proof tab.</p>
    {:else}
      <div class="picker-grid">
        {#each (caseState.current ? proofLibrary : []) as item (item.name)}
          <button class="picker-item" onclick={() => pickProof(item)} title={item.title} disabled={!item.png}>
            <div class="picker-thumb">
              {#if item.png}
                <img src={fileUrl(caseState.current.id, item.png)} alt={item.title} />
              {:else}
                <Icon name="proof" size={24} />
              {/if}
            </div>
            <span class="picker-name">{item.title || item.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .layout {
    display: grid;
    /* both columns whole on a laptop with the case panel open (640px for the tool) */
    grid-template-columns: minmax(240px, 420px) minmax(300px, 1fr);
    gap: 26px;
    padding: 20px;
    max-width: 1200px;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }
  .geo-facts {
    margin-top: 8px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .fact {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    padding: 3px 6px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .fact:hover { background: var(--bg-3); color: var(--text-1); }
  .links {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 6px 2px;
  }
  .loading {
    text-transform: none;
    letter-spacing: 0;
    color: var(--accent);
    font-weight: 500;
  }
  .proof-preview {
    max-height: 200px;
    object-fit: contain;
    padding: 6px;
  }
  /* Thread / tweet blocks */
  .tweet-block {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tweet-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* one line, so a narrow thread column cuts the name rather than stack it */
  .tweet-head .label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tweet-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg-3);
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
    flex-shrink: 0;
  }
  .counter {
    margin-left: auto;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--ok);
    font-family: var(--font-mono);
  }
  .counter.over { color: var(--danger); }
  .post-text {
    font-size: var(--fs-sm);
    line-height: 1.6;
    min-height: 0;
  }
  /* One line reads as the box it used to be; several grow it, up to a point. */
  .post-source {
    min-height: 0;
    line-height: 1.5;
  }
  .media-tabs {
    display: flex;
    gap: 4px;
  }
  .target-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .muted {
    font-size: var(--fs-xs);
    color: var(--text-3);
    padding: 4px 0;
  }
  .thread-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 4px 0;
    flex-wrap: wrap;
  }
  .danger-hover:hover { color: var(--danger); }

  /* header actions */
  .tool-header {
    gap: 16px;
  }
  /* the home lays its own scroll over the whole body */
  .home-body { position: relative; }
  .kind-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: none;
    padding: 2px 9px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--fs-xs);
    font-weight: 600;
    white-space: nowrap;
  }
  /* amber on its own soft ground is too faint on white: darkened there */
  :global(:root[data-theme='light']) .kind-chip { color: color-mix(in srgb, var(--accent) 60%, var(--text-1)); }
  .post-more { flex: none; padding-inline: 5px; color: var(--text-2); }
  .add-notes { padding-inline: 7px; }
  .save-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    color: var(--text-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .save-status.error { color: var(--danger); }
  /* its tick alone at the header's last steps, the word still read aloud */
  .save-status.bare .saved-word { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .modal-lead { margin: 0 0 14px; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .ext-quiet {
    color: var(--text-3);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .tool-header.compact .words { display: inline-block; width: 0; margin-left: -7px; overflow: hidden; }
  .tool-header.narrow .title-input { width: min(200px, 18vw); }
  .tool-header.tight .title-input { width: min(150px, 15vw); }
  .tool-header.saved-bare .title-input { width: min(120px, 12vw); }
  .ext-install {
    color: var(--text-2);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .ext-install:hover { color: var(--accent); }
  .first-pics {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 6px;
  }
  .first-pics img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .style-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .style-head .label { margin: 0; }
  .tpl-settings-link {
    margin-left: auto;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .tpl-settings-link:hover { color: var(--text-2); }
  .tpl-inline-link {
    color: var(--text-3);
    font: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .tpl-inline-link:hover { color: var(--text-2); }

  .tpl-loaded {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 9px;
    border: 1px solid color-mix(in srgb, var(--ok) 45%, var(--border));
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--ok) 10%, transparent);
  }
  .tpl-loaded-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tpl-loaded-name :global(svg) { color: var(--ok); flex-shrink: 0; }
  .tpl-remove {
    margin-left: auto;
    display: inline-flex;
    padding: 2px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .tpl-remove:hover { color: var(--text-1); background: var(--bg-2); }
  .tpl-none {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.4;
  }
  .field-note { margin: 4px 0 0; font-size: var(--fs-xs); color: var(--text-3); }
  .reply-check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: -6px;
    color: var(--text-1);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .reply-check input { margin: 0; accent-color: var(--accent); }
  .field.template-disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }
  .field.template-disabled .input { pointer-events: none; }
  /* Grows with the points it holds, up to four lines, then scrolls. */
  .coords-input { resize: vertical; line-height: 1.5; }
  .field.template-disabled:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: var(--r-sm);
  }
  /* media attachment */
  .media-attach {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 2px;
  }
  .attach-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px 3px 9px;
    background: var(--bg-3);
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    font-family: var(--font-mono);
    color: var(--text-1);
    max-width: 100%;
  }
  .attach-chip a {
    color: var(--text-1);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attach-chip a:hover { color: var(--accent); }
  .chip-x {
    display: inline-flex;
    color: var(--text-3);
  }
  .chip-x:hover { color: var(--danger); }
  .map-making {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  /* media picker */
  .picker-empty {
    color: var(--text-3);
    font-size: var(--fs-sm);
    padding: 8px 0;
  }
  .picker-search {
    margin-bottom: 12px;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .picker-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    text-align: left;
  }
  .picker-thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    overflow: hidden;
    color: var(--text-3);
  }
  .picker-item:hover .picker-thumb {
    border-color: var(--accent);
  }
  .picker-item.selected .picker-thumb {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .picker-item:disabled { cursor: not-allowed; opacity: 0.38; }
  .picker-item:disabled .picker-thumb { border-color: var(--border); }
  .picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .kind-badge {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: var(--r-sm);
    padding: 2px;
    color: #fff;
    display: inline-flex;
  }
  .select-check {
    position: absolute;
    top: 4px;
    left: 4px;
    display: inline-flex;
    padding: 3px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
  }
  .picker-name {
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .modal-actions { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
