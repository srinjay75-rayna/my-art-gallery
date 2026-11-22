export const FALLBACK_CULTURAL_STORIES = [
  {
    id: 'bengal-school-wash',
    hookHeadline: 'A quieter kind of colour: the Bengal School and the art of looking inward',
    teaser: 'When artists searched for an Indian visual voice, delicate washes, poetry and memory became powerful tools.',
    paragraphs: [
      'At the turn of the twentieth century, artists in Bengal began exploring ways of making pictures that felt rooted in Indian stories, literature and ways of seeing. The movement later known as the Bengal School offered a thoughtful alternative to the academic realism popular in colonial art institutions.',
      'Rather than relying only on heavy oil colours and dramatic perspective, artists such as Abanindranath Tagore experimented with delicate washes, softened edges and a lyrical atmosphere. The result could feel like a remembered scene: quiet, intimate and full of suggestion.',
      'The movement was not a single style or a closed chapter. It helped open a wider conversation about artistic independence, education and the many visual languages that could belong to modern India. Its influence can still be felt whenever an artist lets mood, story and material speak together.',
      'At home, a work inspired by this gentler vocabulary can bring calm to a reading corner or a sunlit wall. Give it breathing room, pair it with natural wood or woven textures, and let the image invite a slower look.'
    ],
    collectorBridge: { label: 'Explore original paintings', collectionFilter: 'Paintings' }
  },
  {
    id: 'kalighat-lines',
    hookHeadline: 'From a Kolkata bazaar to the modern gallery: the fearless lines of Kalighat painting',
    teaser: 'Bold brushwork and everyday characters made Kalighat art both accessible and remarkably sharp.',
    paragraphs: [
      'In nineteenth-century Kolkata, painters working near the Kalighat temple created pictures for visitors and residents moving through a busy city. These works were often made quickly on paper, with sweeping outlines, bright colour and figures that could be understood at a glance.',
      'Kalighat painting drew on religious subjects, but it also looked outward. Artists portrayed fashionable city life, familiar occupations and social behaviour, sometimes with humour or pointed satire. A simple curve of the brush could give a figure movement, personality and presence.',
      'The tradition reminds us that important art does not have to be distant from ordinary life. It can be witty, portable, local and responsive to the world outside the studio. Its visual confidence continues to inspire artists who value strong silhouettes and economical storytelling.',
      'A painting with bold shapes can anchor a small wall beautifully. Try placing it against a quiet ivory or deep botanical backdrop, then repeat one colour in a cushion or a small object rather than filling the wall with competing decorations.'
    ],
    collectorBridge: { label: 'See expressive paintings', collectionFilter: 'Paintings' }
  },
  {
    id: 'mithila-patterns',
    hookHeadline: 'A world within a line: the living visual language of Madhubani',
    teaser: 'In the Mithila region, patterned forms, nature and storytelling have carried meaning across generations.',
    paragraphs: [
      'Madhubani, also called Mithila painting, is associated with the Mithila region of Bihar and neighbouring parts of Nepal. Its imagery often brings together plants, animals, ritual motifs and scenes from shared stories, arranged in lively compositions that make the surface feel abundant.',
      'Many works are recognised by their clear outlines, repeated patterns and carefully filled spaces. Different artists and communities use distinct approaches, materials and subjects, so the tradition is not one fixed formula. Its strength lies in the way personal skill meets a living cultural vocabulary.',
      'The history of Madhubani also includes the work of women artists who brought painting from domestic and ritual settings into wider public view. As the practice travelled to paper and other surfaces, artists continued to adapt it while keeping strong connections to place and memory.',
      'A patterned work can become the joyful centre of a room. Let its colours guide a restrained palette nearby, and avoid placing several highly detailed pieces too close together. A little space around the frame allows every line to remain legible.'
    ],
    collectorBridge: { label: 'Discover patterned paintings', collectionFilter: 'Paintings' }
  },
  {
    id: 'rajput-mughal-miniatures',
    hookHeadline: 'Small frames, expansive worlds: reading Mughal and Rajput miniature traditions',
    teaser: 'Courtly scenes, gardens, portraits and landscapes reveal two rich but distinct histories of painting.',
    paragraphs: [
      'Mughal painting developed through imperial workshops where artists combined Persianate manuscript traditions with close observation of people, animals, plants and events. Its pages could be highly detailed, balancing portraiture, historical narrative and an attentive study of the natural world.',
      'Rajput painting grew across several courts and regions, with varied schools and visual concerns. Some works explored devotion and poetry, others celebrated courtly life, seasonal moods or landscapes. Colour, rhythm and symbolic setting could matter as much as literal description.',
      'These traditions were never frozen in time. Artists travelled, exchanged techniques and responded to patrons, texts and local tastes. Looking closely at a miniature reveals how composition, gesture and tiny details can make a small surface feel like an entire world.',
      'A miniature-inspired work rewards a closer viewing distance. Hang it where visitors can pause, perhaps above a console or beside a favourite chair. Use a simple frame and soft lighting so the fine details remain the focus.'
    ],
    collectorBridge: { label: 'Explore detailed paintings', collectionFilter: 'Paintings' }
  },
  {
    id: 'photography-as-memory',
    hookHeadline: 'The patient photograph: how Indian fine-art photography turns a moment into a place',
    teaser: 'A photograph can hold architecture, landscape, gesture and the passing quality of light.',
    paragraphs: [
      'Fine-art photography is more than a record of what stood in front of a camera. The maker chooses where to stand, when to wait, what to include and what to leave outside the frame. Those decisions shape a personal way of seeing.',
      'Across India, photographers work with many subjects: monsoon skies, quiet streets, changing coastlines, built heritage, intimate portraits and abstract details. Process and print matter too. Paper surface, tonal range and edition choices can change how an image feels when viewed on a wall.',
      'A carefully made photograph can sit in conversation with painting without competing with it. One may offer an immediate gesture of colour; the other can invite attention to texture, light or a fleeting expression. Together they can make a collection feel layered and personal.',
      'When choosing a photographic print, consider the room’s light and the viewing distance. A large image can bring a sense of openness to a calm wall, while a smaller edition can create a thoughtful pause on a shelf or in a study.'
    ],
    collectorBridge: { label: 'Explore fine-art photography', collectionFilter: 'Photography' }
  },
  {
    id: 'living-with-art',
    hookHeadline: 'Make the wall feel like home: a collector’s guide to living with Indian art',
    teaser: 'A meaningful wall grows from light, scale and personal connection—not from filling every empty space.',
    paragraphs: [
      'Begin with the room rather than the frame. Notice where daylight falls, where people naturally pause and which wall can be seen from a favourite seat. These small observations help you choose a work that belongs in the rhythm of everyday life.',
      'Scale creates balance. A confident central piece can hold a wall on its own, while a group of smaller works can tell a story through repeated colours, varied formats or a shared subject. Lay out a gallery arrangement on the floor before placing the first nail.',
      'Indian homes often bring together many textures: timber, cane, stone, cotton, brass and handmade objects. Art can connect these materials without matching them exactly. Choose one or two colours from a painting or photograph and echo them softly in the room.',
      'Let your collection change with you. A work may move from a bedroom to a hallway, or a photograph may find a new place beside a painting. The most welcoming interiors are not frozen displays; they are living spaces where each piece earns its place over time.'
    ],
    collectorBridge: { label: 'Browse the full collection', collectionFilter: 'All Works' }
  }
];

export function cleanEditorialText(value, maxLength = 1800) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number(code);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ' ';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const point = parseInt(code, 16);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : ' ';
    })
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
