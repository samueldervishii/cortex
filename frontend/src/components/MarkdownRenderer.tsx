import { lazy, Suspense, memo, useEffect, useState } from 'react'

/*
 * Lazy markdown renderer.
 *
 * react-markdown + remark-gfm + rehype-sanitize together weigh ~120 KB
 * minified — large enough to noticeably delay initial paint on slow
 * connections, especially because they aren't needed until an
 * assistant message arrives. Vite code-splits dynamic imports out of
 * the main bundle, so wrapping them here lets the login screen, chat
 * input, and other UI render instantly while markdown loads in the
 * background. By the time the first assistant token streams back, the
 * lib is normally already there; if not, the plain-text fallback below
 * keeps content readable until it loads.
 */

type LoadedDeps = {
  ReactMarkdown: any
  remarkGfm: any
  rehypeSanitize: any
}

let depsPromise: Promise<LoadedDeps> | null = null

function loadDeps(): Promise<LoadedDeps> {
  // Cache the in-flight promise so concurrent <MarkdownRenderer>
  // mounts don't each trigger their own network/parse cycle.
  if (!depsPromise) {
    depsPromise = Promise.all([
      import('react-markdown'),
      import('remark-gfm'),
      import('rehype-sanitize'),
    ]).then(([rm, rg, rs]) => ({
      ReactMarkdown: (rm as any).default ?? rm,
      remarkGfm: (rg as any).default ?? rg,
      rehypeSanitize: (rs as any).default ?? rs,
    }))
  }
  return depsPromise
}

// Pre-warm: kick off the import as soon as this module is imported,
// so by the time the first assistant message renders the deps are
// usually ready. Done as a side effect inside an effect-only React
// lazy boundary would still incur the wait; doing it eagerly here
// (after the bundle is parsed) gives us the best of both.
loadDeps().catch(() => {
  // Reset on failure so the next call retries — this is rare (network
  // hiccup) but matters because a stuck rejected promise would leave
  // every assistant message stuck on the fallback plain text.
  depsPromise = null
})

const ReactMarkdownLazy = lazy(async () => {
  const deps = await loadDeps()
  return {
    default: (props: { children: string }) => {
      const RM = deps.ReactMarkdown
      return (
        <RM remarkPlugins={[deps.remarkGfm]} rehypePlugins={[deps.rehypeSanitize]}>
          {props.children}
        </RM>
      )
    },
  }
})

interface Props {
  children: string
  /** Class wrapping the rendered markdown — passed through to a div. */
  className?: string
}

/**
 * Renders markdown content. Falls back to a styled <pre> while the
 * markdown bundle loads (rare past the first message, since we
 * pre-warm on module import).
 */
function MarkdownRendererInner({ children, className }: Props) {
  // The Suspense boundary handles the *very first* render while the
  // chunk is still in flight; subsequent renders short-circuit. We
  // also track ready state so we can choose a nicer fallback than
  // a spinner — preserved whitespace text feels more honest than a
  // ghost block on a chat bubble.
  const [ready, setReady] = useState<boolean>(false)
  useEffect(() => {
    let cancelled = false
    loadDeps().then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) {
    return (
      <div className={className}>
        <pre className="markdown-fallback-pre">{children}</pre>
      </div>
    )
  }

  return (
    <div className={className}>
      <Suspense fallback={<pre className="markdown-fallback-pre">{children}</pre>}>
        <ReactMarkdownLazy>{children}</ReactMarkdownLazy>
      </Suspense>
    </div>
  )
}

const MarkdownRenderer = memo(MarkdownRendererInner)
export default MarkdownRenderer
