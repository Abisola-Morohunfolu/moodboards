import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ArrowRight, ImagePlus, Link2, StickyNote } from 'lucide-react';
import { q } from '../lib/hooks';
import { ThemeToggle } from '../components/Theme';
import { Brand } from '../components/Brand';
import { ItemCardView } from '../features/board/ItemCard';

export const Route = createFileRoute('/')({
  component: Home,
  head: () => ({
    meta: [
      { title: 'Moodboard | Good ideas belong together' },
      {
        name: 'description',
        content:
          'Collect images, links, and notes on visual boards. Organize inspiration for rooms, weddings, projects, and everyday plans.',
      },
      { property: 'og:title', content: 'Moodboard | Good ideas belong together' },
      {
        property: 'og:description',
        content:
          'A visual home for your next idea. Collect images, links, and notes, then arrange them your way.',
      },
      { property: 'og:type', content: 'website' },
      { property: 'og:image', content: '/images/living-room.webp' },
    ],
  }),
});
const examples = [
  {
    title: 'A room that feels like you',
    image: 'living-room',
    alt: 'Bright living room with a blue sofa and sculptural furniture',
  },
  {
    title: 'A day to remember',
    image: 'wedding-table',
    alt: 'Garden wedding table with flowers and pale blue linen',
  },
  {
    title: 'Your next creative project',
    image: 'creative-desk',
    alt: 'Design references and blue swatches on a creative desk',
  },
];
function Home() {
  const me = q.account();
  const navigate = useNavigate();
  useEffect(() => {
    if (me.isSuccess) {
      void navigate({ to: '/boards', replace: true });
    }
  }, [me.isSuccess, navigate]);
  return (
    <main className="bg-paper">
      <header className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-4 px-5 md:px-10">
        <Link to="/" aria-label="Moodboard home">
          <Brand />
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-5 text-sm font-semibold">
          <ThemeToggle />
          <a href="#ideas" className="hidden text-muted hover:text-ink sm:block">
            Explore ideas
          </a>
          <Link
            to="/login"
            search={{ mode: 'login' }}
            className="inline-flex min-h-11 items-center"
          >
            Sign in <ArrowRight size={15} className="ml-2" />
          </Link>
        </nav>
      </header>
      <div className="mx-auto max-w-7xl px-5 md:px-10">
        <section className="landing-hero" aria-labelledby="hero-title">
          <div>
            <h1
              id="hero-title"
              className="max-w-lg text-[clamp(2.5rem,4.5vw,3.75rem)] font-semibold leading-[1.08] tracking-[-.035em]"
            >
              Good ideas
              <br className="hidden sm:block" /> belong together.
            </h1>
            <p className="mt-6 max-w-sm text-base leading-7 text-muted">
              Collect images, links, and notes in one place. Make room for your next idea.
            </p>
            <Link
              to="/login"
              search={{ mode: 'signup' }}
              className="ui-button mt-8 inline-flex min-h-12 items-center gap-3 rounded-lg bg-accent px-6 text-sm font-semibold text-on-accent hover:bg-accent-strong"
            >
              Create a board <ArrowRight size={17} />
            </Link>
          </div>
          <div className="example-board">
            <div className="mb-5 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">A little space to call home</p>
              <span className="text-xs text-muted">Example board</span>
            </div>
            <div className="example-board-items">
              <ItemCardView
                title="Light, texture, a little blue"
                imageUrl="/images/living-room.webp"
                imageSrcSet="/images/living-room-480.webp 480w, /images/living-room-800.webp 800w, /images/living-room.webp 1440w"
                imageSizes="(min-width: 768px) 320px, calc(100vw - 88px)"
                priority
              />
              <ItemCardView
                title="The details make it yours"
                imageUrl="/images/creative-desk.webp"
                imageSrcSet="/images/creative-desk-480.webp 480w, /images/creative-desk-800.webp 800w, /images/creative-desk.webp 1440w"
                imageSizes="(min-width: 768px) 260px, calc(100vw - 88px)"
              />
              <ItemCardView
                title="The feeling"
                note="Natural light. Soft textures. Space for the things we love."
              />
            </div>
          </div>
        </section>
        <section
          id="ideas"
          aria-labelledby="ideas-title"
          className="border-t border-line py-16 md:py-20"
        >
          <h2 id="ideas-title" className="text-2xl font-semibold tracking-tight md:text-3xl">
            Whatever you're imagining.
          </h2>
          <p className="mt-3 text-sm text-muted">
            Example inspiration for rooms, celebrations, and creative projects.
          </p>
          <div className="mt-8 grid gap-8 md:grid-cols-[1.2fr_1fr_1fr]">
            {examples.map((example) => (
              <figure key={example.image}>
                <img
                  src={`/images/${example.image}.webp`}
                  srcSet={`/images/${example.image}-480.webp 480w, /images/${example.image}-800.webp 800w, /images/${example.image}.webp 1440w`}
                  sizes="(min-width: 1280px) 440px, (min-width: 768px) 33vw, calc(100vw - 40px)"
                  alt={example.alt}
                  width={1440}
                  height={1080}
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-xl object-cover"
                />
                <figcaption className="mt-4 text-sm font-medium">{example.title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
        <section
          className="grid gap-10 border-t border-line py-16 md:grid-cols-[1fr_1.2fr] md:py-20"
          aria-labelledby="collect-title"
        >
          <div>
            <h2
              id="collect-title"
              className="max-w-md text-3xl font-semibold leading-tight tracking-tight"
            >
              Less scattered.
              <br />
              More space to think.
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-muted">
              Keep the references you want to return to, arranged in a way that makes sense to you.
            </p>
          </div>
          <div className="space-y-7">
            <div className="flex gap-4">
              <ImagePlus size={21} className="mt-1 shrink-0 text-accent" />
              <div>
                <h3 className="text-base font-semibold">Collect what catches your eye</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Add images, save links, and keep notes beside your inspiration.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <StickyNote size={21} className="mt-1 shrink-0 text-accent" />
              <div>
                <h3 className="text-base font-semibold">Arrange it your way</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Move ideas around the canvas and group them into sections.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <Link2 size={21} className="mt-1 shrink-0 text-accent" />
              <div>
                <h3 className="text-base font-semibold">Bring clients into the picture</h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  For client projects, share a private viewing link to a single board.
                </p>
              </div>
            </div>
          </div>
        </section>
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-7 text-xs text-muted">
          <Brand />
          <span>A home for your ideas.</span>
        </footer>
      </div>
    </main>
  );
}
