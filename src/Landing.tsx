import type { IconType } from 'react-icons'
import { LuCamera, LuExternalLink, LuLightbulb, LuMegaphone, LuMic, LuUsers } from 'react-icons/lu'
import { CLUB_URL, SIGNUP_FORM_URL } from './links.ts'
import './Landing.css'

type Activity = { icon: IconType; title: string; body: string }

// Copy below comes from the club's RankUoG profile
const ACTIVITIES: Activity[] = [
  {
    icon: LuCamera,
    title: 'Hands-on workshops',
    body: 'Photography and video from your phone, short-form editing, captions, design with Canva, and planning a content calendar.',
  },
  {
    icon: LuMegaphone,
    title: 'Real projects',
    body: 'Covering campus events, running campaigns for other UG clubs, and building a portfolio you can show employers.',
  },
  {
    icon: LuLightbulb,
    title: 'Strategy sessions',
    body: 'How platforms work, what makes posts land, reading your analytics, and staying safe and professional online.',
  },
  {
    icon: LuMic,
    title: 'Guest talks',
    body: 'Guyanese creators, marketers and small-business owners share what works for them.',
  },
]

type Story = { image: string; alt: string; title: string; body: string; href: string }

const STORIES: Story[] = [
  {
    image: '/landing/hunters-moon.webp',
    alt: 'Two students looking up at a bright full moon in the night sky',
    title: "Hunter's Moon & star clusters with UGAS",
    body: 'We joined the University of Guyana Astronomy Society for a night under the Hunter’s Moon. Members took turns at the telescope, picking out star clusters, and we were there with our cameras to catch it all.',
    href: 'https://rankuog.com/clubs/social-media/collections/7a2e04e0-5d98-4cb0-9e7d-0c880b88a0e6',
  },
  {
    image: '/landing/crime-scene.webp',
    alt: 'Yellow caution tape across a wall of blood-spattered newspapers',
    title: 'Fright Night',
    body: 'A red-lit crime scene, caution tape and a masked guest. Everyone brought the drama, the fear faces and the questionable knife skills, and we caught every second of it.',
    href: 'https://rankuog.com/clubs/social-media/collections/9aca8c0d-6eb6-406e-a128-97d0352ad3d6',
  },
]

function ExternalIcon() {
  return (
    <>
      <LuExternalLink aria-hidden="true" />
      <span className="visually-hidden">(opens in a new tab)</span>
    </>
  )
}

function Landing() {
  return (
    <div className="landing">
      <section className="hero">
        <img className="hero-logo" src="/logo-badge.webp" alt="" width={112} height={112} />
        <p className="hero-eyebrow">University of Guyana · Social Media club</p>
        <h1 className="hero-title">
          Create content, <span className="highlight">tell stories</span> and <span className="highlight">grow an audience</span>
        </h1>
        <p className="hero-lead">
          The Social Media Club is for students who want to get better at creating content, telling stories online and
          growing an audience, whether for themselves, a business or a cause.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={SIGNUP_FORM_URL} target="_blank" rel="noreferrer">
            Join the club
            <span className="visually-hidden">(opens in a new tab)</span>
          </a>
          <a className="btn btn-secondary" href={CLUB_URL} target="_blank" rel="noreferrer">
            View on RankUoG <ExternalIcon />
          </a>
        </div>
        <a className="hero-link" href="#what-we-do">
          <LuUsers aria-hidden="true" /> See what we do
        </a>
      </section>

      <div className="showcase" aria-label="Photos by club members">
        <div className="showcase-window">
          <div className="showcase-bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="showcase-grid">
            <img className="tile-wide" src="/landing/telescope.webp" alt="A student looking through a telescope at night" />
            <img src="/landing/fright-night.webp" alt="A masked figure in a Ghostface costume holding a bat at Fright Night" />
            <img src="/landing/face-paint.webp" alt="A student in skull face paint at Fright Night" />
          </div>
        </div>
      </div>

      <section className="landing-section service">
        <h2>
          A <span className="highlight">service club</span> for the UG community
        </h2>
        <p>
          Our members put their skills to work for the university: we help other clubs, student events and campus
          initiatives get seen.
        </p>
      </section>

      <section className="landing-section" id="what-we-do" aria-labelledby="what-we-do-title">
        <h2 id="what-we-do-title">What we do</h2>
        <ul className="activity-grid">
          {ACTIVITIES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="activity-card">
              <Icon className="activity-icon" aria-hidden="true" />
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section" aria-labelledby="recent-title">
        <h2 id="recent-title">Recently on camera</h2>
        <ul className="story-grid">
          {STORIES.map((story) => (
            <li key={story.title} className="story-card">
              <img src={story.image} alt={story.alt} loading="lazy" />
              <div className="story-body">
                <h3>{story.title}</h3>
                <p>{story.body}</p>
                <a href={story.href} target="_blank" rel="noreferrer">
                  See the photos <ExternalIcon />
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section join" aria-labelledby="join-title">
        <h2 id="join-title">
          Everyone is <span className="highlight">welcome</span>
        </h2>
        <p>
          Any faculty, any year. You don&rsquo;t need experience or expensive gear; a phone and some curiosity are enough.
          Studying marketing, communications or business? It&rsquo;s a great place to practise. If you&rsquo;re not,
          it&rsquo;s a skill that helps whatever you do next.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={SIGNUP_FORM_URL} target="_blank" rel="noreferrer">
            Fill in the sign-up form
            <span className="visually-hidden">(opens in a new tab)</span>
          </a>
          <a className="btn btn-secondary" href={CLUB_URL} target="_blank" rel="noreferrer">
            Follow us on RankUoG <ExternalIcon />
          </a>
        </div>
      </section>

      <footer className="landing-footer">
        <span>
          <img src="/logo-badge.webp" alt="" width={24} height={24} /> University of Guyana Social Media Club
        </span>
        <a href="/admin">Admin</a>
      </footer>
    </div>
  )
}

export default Landing
