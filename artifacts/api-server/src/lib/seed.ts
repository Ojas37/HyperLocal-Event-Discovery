import { eq } from "drizzle-orm";
import { db, eventsTable, organizersTable } from "@workspace/db";

const organizers = [
  {
    ownerId: "localloop-demo-organizer-ai",
    name: "Makers & Models",
    type: "community",
    description: "A community for curious builders exploring applied AI.",
  },
  {
    ownerId: "localloop-demo-organizer-code",
    name: "Code Commons",
    type: "community",
    description: "Friendly, practical sessions for people who love making things.",
  },
  {
    ownerId: "localloop-demo-organizer-founders",
    name: "First Mile Founders",
    type: "startup",
    description: "A gathering place for people building their first big idea.",
  },
  {
    ownerId: "localloop-demo-organizer-design",
    name: "Open Studio Circle",
    type: "community",
    description: "Designers and makers learning from one another in public.",
  },
];

const eventSeeds = [
  ["ai-build-night", 0, "AI Build Night: Small Models, Useful Things", "Artificial Intelligence", "A hands-on evening for building practical AI prototypes with small, open models. Bring a laptop and one problem you would like to make easier.", "Pune", "The Mills Social", ["AI", "Beginner friendly", "Build night"], 4, 0, "photo-1531482615713-2afd69097998"],
  ["python-first-project", 1, "Python, From Zero to Your First Project", "Software Development", "A welcoming, guided workshop for first-time programmers. Learn the basics by making a tiny project you can take home.", "Mumbai", "The Thoughtworks Loft", ["Python", "Beginner", "Workshop"], 7, 250, "photo-1516321318423-f06f85e504b3"],
  ["secure-by-design-ctf", 1, "Secure by Design: Community CTF", "Cybersecurity", "A team-based capture-the-flag afternoon with beginner and intermediate challenges in web security, forensics, and cryptography.", "Bengaluru", "91Springboard, Koramangala", ["Cybersecurity", "CTF", "Teams"], 11, 0, "photo-1550751827-4bd374c3f58b"],
  ["founder-coffee", 2, "Founder Coffee: The First Ten Customers", "Startups and Entrepreneurship", "An informal morning for early-stage founders to compare notes, share what is working, and meet useful collaborators.", "Delhi", "Third Wave Coffee, Hauz Khas", ["Startups", "Networking", "Founders"], 14, 199, "photo-1521737604893-d14cc237f11d"],
  ["web-makers-lab", 1, "Web Makers Lab: Ship a Tiny Product", "Web Development", "Turn a small idea into a working web experience in one afternoon. Pair with other builders and leave with a link you can share.", "Hyderabad", "T-Hub, Madhapur", ["Web development", "React", "Build session"], 17, 0, "photo-1519389950473-47ba0277781c"],
  ["data-stories", 0, "Data Stories: From Messy CSV to Clear Insight", "Data Science", "Bring a small dataset or use one of ours. Learn a repeatable path from exploration to a clear, useful visual story.", "Chennai", "Anna Centenary Library", ["Data science", "Visualization", "Workshop"], 20, 350, "photo-1551288049-bebda4e38f71"],
  ["design-critique", 3, "Open Design Critique: Work in Progress", "Product and Design", "A generous, practical critique circle for people working on digital products. Share a current challenge or join as a thoughtful listener.", "Pune", "The Daftar, Baner", ["Design", "Product", "Community"], 23, 0, "photo-1552664730-d307ca884978"],
  ["campus-tech-fest", 1, "Campus Tech Fest: Build, Play, Meet", "Cultural Events", "A campus-wide day of maker demos, student projects, music, and friendly competitions. Open to students and curious neighbors.", "Mumbai", "IIT Bombay, Powai", ["Campus", "Festival", "Students"], 27, 100, "photo-1540575467063-178a50c2df87"],
  ["career-conversations", 2, "Career Conversations: Paths Into Product", "Career and Placement", "Meet people working across product roles and ask honest questions about portfolios, interviews, and getting your first opportunity.", "Bengaluru", "WeWork Galaxy", ["Careers", "Product", "Students"], 30, 0, "photo-1522071820081-009f0129c71c"],
  ["open-source-hour", 1, "Open Source First Contribution Hour", "Software Development", "Make a first contribution with help from maintainers and peers. We will find a friendly issue, get your setup ready, and walk through the pull request.", "Online", "Online community room", ["Open source", "Git", "Beginner"], 33, 0, "photo-1516321497487-e288fb19713f"],
  ["climate-startup-summit", 2, "Climate Builders: Ideas Into Action", "Business and Finance", "A focused evening bringing together climate founders, operators, and people looking for ways to contribute to the transition.", "Delhi", "The Quorum, Gurugram", ["Climate", "Entrepreneurship", "Networking"], 37, 499, "photo-1497366754035-f200968a6e72"],
  ["ml-research-to-product", 0, "From ML Research to Product: A Practical Meetup", "Artificial Intelligence", "Practitioners share what it takes to move a model from a paper or notebook into a product people can use.", "Hyderabad", "Microsoft Reactor", ["Machine learning", "AI", "Talks"], 41, 0, "photo-1451187580459-43490279c0fa"],
  ["design-systems-study", 3, "Design Systems Study Hall", "Product and Design", "Bring one component or token problem. Work alongside designers and frontend developers in a relaxed, collaborative study session.", "Chennai", "The Hive, Alwarpet", ["Design systems", "Frontend", "Study hall"], 45, 150, "photo-1498050108023-c5249f4df085"],
  ["product-people-evening", 2, "Product People: A No-Slides Networking Evening", "Networking", "Meet product-minded people across industries. No stage, no pitch deck—just good questions and useful conversations.", "Mumbai", "WeWork BKC", ["Networking", "Product", "Community"], 49, 0, "photo-1517248135467-4c7edcad34c4"],
  ["web-accessibility-workshop", 1, "Build for Everyone: Web Accessibility Workshop", "Web Development", "Learn practical accessibility checks for forms, navigation, color, and keyboard use, then apply them to a small page.", "Pune", "Community Hall, Kalyani Nagar", ["Accessibility", "Web development", "Workshop"], 53, 299, "photo-1497366216548-37526070297c"],
  ["student-founder-showcase", 2, "Student Founder Showcase & Demo Hour", "Startups and Entrepreneurship", "Student teams share what they are building, get thoughtful feedback, and meet mentors who can help with the next step.", "Bengaluru", "NSRCEL, IIM Bangalore", ["Students", "Startups", "Demo day"], 57, 0, "photo-1556761175-b413da4baf72"],
];

const photoUrl = (photoId: string) =>
  `https://images.unsplash.com/${photoId}?auto=format&fit=crop&w=1200&q=82`;

export async function seedDemoEvents(): Promise<void> {
  const organizerIds: number[] = [];
  for (const seed of organizers) {
    const [existing] = await db
      .select({ id: organizersTable.id })
      .from(organizersTable)
      .where(eq(organizersTable.ownerId, seed.ownerId));
    if (existing) {
      organizerIds.push(existing.id);
      continue;
    }
    const [created] = await db
      .insert(organizersTable)
      .values(seed)
      .returning({ id: organizersTable.id });
    organizerIds.push(created.id);
  }

  const now = Date.now();
  for (const [slug, organizerIndex, title, category, description, city, venue, tags, days, price, photoId] of eventSeeds) {
    const startAt = new Date(now + Number(days) * 24 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 2 * 60 * 60 * 1000);
    const registrationDeadline = new Date(startAt.getTime() - 60 * 60 * 1000);
    await db
      .insert(eventsTable)
      .values({
        organizerId: organizerIds[Number(organizerIndex)],
        slug: String(slug),
        title: String(title),
        description: String(description),
        category: String(category),
        tags: tags as string[],
        bannerUrl: photoUrl(String(photoId)),
        startAt,
        endAt,
        timezone: "Asia/Kolkata",
        venue: String(venue),
        city: String(city),
        mode: String(city) === "Online" ? "online" : "in-person",
        price: Number(price),
        currency: "INR",
        capacity: 80,
        registrationDeadline,
        externalUrl: null,
        status: "published",
        isDemo: true,
      })
      .onConflictDoNothing({ target: eventsTable.slug });
  }
}
