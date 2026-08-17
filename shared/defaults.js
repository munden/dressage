/*
 * Pixel Passage — shared/defaults.js (tests-data)
 * UMD: sets window.DR_DEFAULTS in the browser AND module.exports in Node.
 * Seed data: USDF-style test definitions, collective marks, judge quick-note
 * chips, and ~8 sample calendar events over the 60 days following 2026-08-17.
 */
(function (root, factory) { const d = factory();
  if (typeof module === 'object' && module.exports) module.exports = d; else root.DR_DEFAULTS = d;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ------------------------------------------------------------------
  // Tests — USDF-style defaults. Coefficient 2 marks the movements that
  // typically carry double weight (free walk, stretch circles, medium
  // walk at Intro, lengthenings at First, etc.).
  // ------------------------------------------------------------------
  const tests = [

    // ---------------- Introductory Level (walk–trot / intro canter) ----------------
    {
      id: 'intro-a',
      name: 'Introductory Level Test A',
      shortName: 'Intro A',
      level: 'Introductory',
      arena: 'small',
      purpose: 'To introduce the rider and/or horse to the sport of dressage: correct geometry, steady tempo, and a soft, elastic contact in walk and trot.',
      movements: [
        { num: 1, name: 'A Enter working trot rising. X Halt through medium walk, salute. Proceed working trot rising.', directive: 'Straight entry on centerline; smooth, balanced transitions; immobile halt.', coefficient: 1 },
        { num: 2, name: 'C Track left. E Circle left 20m, working trot rising.', directive: 'Correct 20m geometry; bend along the arc; consistent tempo.', coefficient: 1 },
        { num: 3, name: 'Between K & A Medium walk.', directive: 'Willing, balanced downward transition; clear four-beat rhythm.', coefficient: 1 },
        { num: 4, name: 'F–E Free walk on a long rein. E Medium walk.', directive: 'Complete freedom to stretch the neck forward and down; ground cover; relaxation.', coefficient: 2 },
        { num: 5, name: 'Before E Shorten the reins. E Working trot rising.', directive: 'Prompt, calm transition; maintenance of rhythm and contact.', coefficient: 1 },
        { num: 6, name: 'B Circle right 20m, working trot rising.', directive: 'Correct size and shape; bend to the right; steady tempo.', coefficient: 1 },
        { num: 7, name: 'A Down centerline. Between D & X Medium walk.', directive: 'Straightness on centerline; balanced, smooth transition.', coefficient: 1 },
        { num: 8, name: 'X Halt through medium walk, salute.', directive: 'Straight, square, immobile halt; halt maintained 3 seconds.', coefficient: 1 },
        { num: 9, name: 'Leave arena in free walk on a long rein at A.', directive: 'Relaxation; stretch over the topline; willingness to march.', coefficient: 1 }
      ]
    },

    {
      id: 'intro-b',
      name: 'Introductory Level Test B',
      shortName: 'Intro B',
      level: 'Introductory',
      arena: 'small',
      purpose: 'To confirm the horse and rider in walk and trot with changes of rein, half circles, and clear transitions between and within gaits.',
      movements: [
        { num: 1, name: 'A Enter working trot rising. X Halt through medium walk, salute. Proceed working trot rising.', directive: 'Straightness on centerline; smooth transitions; square, immobile halt.', coefficient: 1 },
        { num: 2, name: 'C Track right. B Circle right 20m, working trot rising.', directive: 'Correct geometry; bend and balance on the circle; regular rhythm.', coefficient: 1 },
        { num: 3, name: 'K–X–M Change rein, working trot rising.', directive: 'Straightness on the diagonal; change of bend at X; steady tempo.', coefficient: 1 },
        { num: 4, name: 'Between C & H Medium walk.', directive: 'Balanced, willing transition; clarity of the walk rhythm.', coefficient: 1 },
        { num: 5, name: 'E–K Free walk on a long rein. K Medium walk.', directive: 'Freedom of the shoulder; stretch forward and down; ground cover.', coefficient: 2 },
        { num: 6, name: 'Before A Shorten the reins. A Working trot rising.', directive: 'Prompt, obedient transition; maintenance of contact and rhythm.', coefficient: 1 },
        { num: 7, name: 'E Circle left 20m, working trot rising.', directive: 'Correct size and shape; bend to the left; engagement maintained.', coefficient: 1 },
        { num: 8, name: 'F–X–H Change rein, working trot rising.', directive: 'Straightness; balance through the change of bend at X.', coefficient: 1 },
        { num: 9, name: 'C Down centerline (half circle). Between G & C Medium walk.', directive: 'Bend and balance in the turn; smooth downward transition.', coefficient: 1 },
        { num: 10, name: 'G Halt through medium walk, salute.', directive: 'Straight, square, immobile halt on centerline.', coefficient: 1 }
      ]
    },

    {
      id: 'intro-c',
      name: 'Introductory Level Test C',
      shortName: 'Intro C',
      level: 'Introductory',
      arena: 'standard',
      purpose: 'To introduce the canter: the horse shall show clear transitions into and out of canter on 20m circles while maintaining rhythm and balance in all three gaits.',
      movements: [
        { num: 1, name: 'A Enter working trot rising. X Halt through medium walk, salute. Proceed working trot rising.', directive: 'Straight entry; balanced transitions; immobility at the halt.', coefficient: 1 },
        { num: 2, name: 'C Track left. E Circle left 20m, working trot rising.', directive: 'Correct geometry; left bend; regular rhythm and tempo.', coefficient: 1 },
        { num: 3, name: 'Between E & K Working canter, left lead. A Circle left 20m, working canter.', directive: 'Prompt, balanced transition; correct lead; round circle.', coefficient: 1 },
        { num: 4, name: 'Between A & F Working trot rising.', directive: 'Balanced, smooth downward transition; steadiness of the frame.', coefficient: 1 },
        { num: 5, name: 'B Circle right 20m, working trot rising. Between B & M Medium walk.', directive: 'Correct bend right; willing, balanced transition to walk.', coefficient: 1 },
        { num: 6, name: 'H–X–F Change rein, free walk on a long rein. F Medium walk.', directive: 'Complete freedom to stretch; ground cover; relaxation of the back.', coefficient: 2 },
        { num: 7, name: 'A Working trot rising. E Circle right 20m, working trot rising.', directive: 'Prompt transition; correct 20m geometry with right bend.', coefficient: 1 },
        { num: 8, name: 'Between E & H Working canter, right lead. C Circle right 20m, working canter.', directive: 'Correct lead; balance and rhythm in the transition and on the circle.', coefficient: 1 },
        { num: 9, name: 'Between C & M Working trot rising.', directive: 'Balance in the downward transition; maintenance of tempo.', coefficient: 1 },
        { num: 10, name: 'A Down centerline. X Halt through medium walk, salute.', directive: 'Straightness on centerline; square, immobile halt.', coefficient: 1 }
      ]
    },

    // ---------------- Training Level ----------------
    {
      id: 'training-1',
      name: 'Training Level Test 1',
      shortName: 'Training 1',
      level: 'Training',
      arena: 'standard',
      purpose: 'To confirm that the horse demonstrates correct basics: supple, moves freely forward in clear rhythm with a steady tempo, accepting contact with the bit.',
      movements: [
        { num: 1, name: 'A Enter working trot. X Halt through medium walk, salute. Proceed working trot.', directive: 'Straightness on centerline; smooth transitions; straight, attentive halt.', coefficient: 1 },
        { num: 2, name: 'C Track left. E Circle left 20m.', directive: 'Regularity and quality of trot; correct geometry and bend.', coefficient: 1 },
        { num: 3, name: 'Between E & K Working canter, left lead.', directive: 'Willing, calm transition; correct lead; clear three-beat rhythm.', coefficient: 1 },
        { num: 4, name: 'A Circle left 20m, working canter.', directive: 'Quality of canter; correct size and shape; uphill tendency.', coefficient: 1 },
        { num: 5, name: 'Between B & M Working trot.', directive: 'Balanced, smooth downward transition; maintenance of rhythm.', coefficient: 1 },
        { num: 6, name: 'Between C & H Medium walk.', directive: 'Willing transition; regularity and quality of the walk.', coefficient: 1 },
        { num: 7, name: 'E–X–B Change rein, free walk. B Medium walk.', directive: 'Regularity; complete freedom to stretch the neck forward and down; ground cover.', coefficient: 2 },
        { num: 8, name: 'Between B & F Working trot.', directive: 'Prompt, balanced transition; steadiness of the contact.', coefficient: 1 },
        { num: 9, name: 'E Circle right 20m.', directive: 'Regularity and quality of trot; bend and balance to the right.', coefficient: 1 },
        { num: 10, name: 'Between E & H Working canter, right lead.', directive: 'Calm, obedient transition; correct lead.', coefficient: 1 },
        { num: 11, name: 'C Circle right 20m, working canter.', directive: 'Quality of canter; correct geometry; consistent tempo.', coefficient: 1 },
        { num: 12, name: 'Between B & F Working trot.', directive: 'Balance in the transition; rhythm maintained.', coefficient: 1 },
        { num: 13, name: 'A Down centerline. X Halt through medium walk, salute.', directive: 'Straightness; smooth, balanced transitions; square, immobile halt.', coefficient: 1 }
      ]
    },

    {
      id: 'training-2',
      name: 'Training Level Test 2',
      shortName: 'Training 2',
      level: 'Training',
      arena: 'standard',
      purpose: 'To build on Test 1: the horse shows greater suppleness and thrust, with a stretch circle in trot confirming connection over the back.',
      movements: [
        { num: 1, name: 'A Enter working trot. X Halt through medium walk, salute. Proceed working trot.', directive: 'Straight entry; balanced transitions; immobility.', coefficient: 1 },
        { num: 2, name: 'C Track right. B Circle right 20m.', directive: 'Quality of trot; correct bend and geometry.', coefficient: 1 },
        { num: 3, name: 'K–X–M Change rein.', directive: 'Straightness on the diagonal; change of bend; steady tempo.', coefficient: 1 },
        { num: 4, name: 'Between C & H Working canter, left lead.', directive: 'Prompt, balanced transition; correct lead.', coefficient: 1 },
        { num: 5, name: 'E Circle left 20m, working canter.', directive: 'Quality of the canter; correct size; uphill balance.', coefficient: 1 },
        { num: 6, name: 'Between K & A Working trot.', directive: 'Balance in the downward transition; rhythm maintained.', coefficient: 1 },
        { num: 7, name: 'A Circle left 20m, rising trot, allowing the horse to stretch forward and downward.', directive: 'Forward and downward stretch over the back into a light contact; bend; correct geometry.', coefficient: 2 },
        { num: 8, name: 'Before A Shorten the reins. Between A & F Medium walk.', directive: 'Smooth retake of contact; willing transition to walk.', coefficient: 1 },
        { num: 9, name: 'F–E Change rein, free walk. E Medium walk.', directive: 'Regularity; freedom of the shoulder; complete stretch; ground cover.', coefficient: 2 },
        { num: 10, name: 'Before H Shorten the reins. H Working trot.', directive: 'Prompt, calm transition; steadiness of contact.', coefficient: 1 },
        { num: 11, name: 'Between C & M Working canter, right lead. B Circle right 20m, working canter.', directive: 'Correct lead; quality and balance of the canter on the circle.', coefficient: 1 },
        { num: 12, name: 'Between F & A Working trot.', directive: 'Balanced downward transition; maintenance of tempo.', coefficient: 1 },
        { num: 13, name: 'A Down centerline. X Halt through medium walk, salute.', directive: 'Straightness on centerline; square, immobile halt.', coefficient: 1 }
      ]
    },

    {
      id: 'training-3',
      name: 'Training Level Test 3',
      shortName: 'Training 3',
      level: 'Training',
      arena: 'standard',
      purpose: 'To confirm all Training Level requirements: canter loops toward centerline, trot and canter stretch work, and prompt, balanced transitions throughout.',
      movements: [
        { num: 1, name: 'A Enter working trot. X Halt through medium walk, salute. Proceed working trot.', directive: 'Straightness; smooth transitions in and out of halt; immobility.', coefficient: 1 },
        { num: 2, name: 'C Track left. H–X–F Change rein.', directive: 'Quality of trot; straightness on the diagonal; balance in corners.', coefficient: 1 },
        { num: 3, name: 'A Circle left 20m, rising trot, allowing the horse to stretch forward and downward.', directive: 'Forward-downward stretch over a round back; rhythm; correct geometry.', coefficient: 2 },
        { num: 4, name: 'Before A Shorten the reins. A Working trot.', directive: 'Smooth retake of the reins; balance maintained.', coefficient: 1 },
        { num: 5, name: 'Between K & E Working canter, left lead.', directive: 'Calm, prompt transition; correct lead.', coefficient: 1 },
        { num: 6, name: 'E Circle left 20m, working canter.', directive: 'Quality of canter; correct size and bend.', coefficient: 1 },
        { num: 7, name: 'E–X–B Single loop to quarterline and return, working canter.', directive: 'Balance and alignment through the shallow loop; quality of canter maintained.', coefficient: 1 },
        { num: 8, name: 'Between C & M Working trot. Between M & B Medium walk.', directive: 'Balanced, fluid downward transitions; clear walk rhythm.', coefficient: 1 },
        { num: 9, name: 'B–X–E Change rein, free walk. E Medium walk.', directive: 'Regularity; complete freedom to stretch; ground cover; relaxation.', coefficient: 2 },
        { num: 10, name: 'Before K Shorten the reins. K Working trot.', directive: 'Willing transition; steadiness of contact and tempo.', coefficient: 1 },
        { num: 11, name: 'A Circle right 20m. Between A & F Working canter, right lead.', directive: 'Bend right; prompt, balanced strike-off; correct lead.', coefficient: 1 },
        { num: 12, name: 'B Circle right 20m, working canter.', directive: 'Quality of the canter; geometry; uphill tendency.', coefficient: 1 },
        { num: 13, name: 'Between H & C Working trot.', directive: 'Balance in the downward transition; rhythm maintained.', coefficient: 1 },
        { num: 14, name: 'A Down centerline. X Halt through medium walk, salute.', directive: 'Straightness on centerline; square, immobile, attentive halt.', coefficient: 1 }
      ]
    },

    // ---------------- First Level ----------------
    {
      id: 'first-1',
      name: 'First Level Test 1',
      shortName: 'First 1',
      level: 'First',
      arena: 'standard',
      purpose: 'To confirm that the horse has developed thrust and achieves improved balance and throughness: 10m half circles, lengthenings of stride in trot and canter.',
      movements: [
        { num: 1, name: 'A Enter working trot. X Halt, salute. Proceed working trot.', directive: 'Straightness; engaged, balanced transitions; square halt without walk steps.', coefficient: 1 },
        { num: 2, name: 'C Track left. E Circle left 10m.', directive: 'Correct geometry; bend without tilting; engagement maintained.', coefficient: 1 },
        { num: 3, name: 'K–X–M Change rein, lengthen stride in trot.', directive: 'Moderate lengthening of frame and stride; consistent tempo; balanced transitions.', coefficient: 2 },
        { num: 4, name: 'Between C & H Medium walk.', directive: 'Willing, balanced transition; regularity of walk.', coefficient: 1 },
        { num: 5, name: 'H–X–F Change rein, free walk. F Medium walk.', directive: 'Regularity; complete freedom to stretch; ground cover.', coefficient: 2 },
        { num: 6, name: 'A Working trot. Between A & K Working canter, left lead.', directive: 'Prompt, uphill transitions; correct lead.', coefficient: 1 },
        { num: 7, name: 'E Circle left 15m, working canter.', directive: 'Correct size; bend and balance; quality of the canter.', coefficient: 1 },
        { num: 8, name: 'H–X–F Change rein, working canter. X Working trot.', directive: 'Straightness on the diagonal; balanced trot transition at X.', coefficient: 1 },
        { num: 9, name: 'Between F & A Working canter, right lead.', directive: 'Calm, prompt strike-off; correct lead.', coefficient: 1 },
        { num: 10, name: 'B Circle right 15m, working canter.', directive: 'Geometry; uphill balance; consistent tempo.', coefficient: 1 },
        { num: 11, name: 'M–X–K Change rein, lengthen stride in canter. Before K Working canter.', directive: 'Clear lengthening of stride and frame; balance in both transitions.', coefficient: 1 },
        { num: 12, name: 'Between K & A Working trot. E Circle right 10m.', directive: 'Balanced downward transition; correct 10m bend and geometry.', coefficient: 1 },
        { num: 13, name: 'A Down centerline. X Halt, salute.', directive: 'Straightness; engagement into a square, immobile halt.', coefficient: 1 }
      ]
    },

    {
      id: 'first-2',
      name: 'First Level Test 2',
      shortName: 'First 2',
      level: 'First',
      arena: 'standard',
      purpose: 'To build on Test 1 with leg-yields, shallow counter-canter loops, and clearer lengthenings demonstrating improved thrust and throughness.',
      movements: [
        { num: 1, name: 'A Enter working trot. X Halt, salute. Proceed working trot.', directive: 'Straight, engaged entry; square, immobile halt.', coefficient: 1 },
        { num: 2, name: 'C Track right. B Circle right 10m.', directive: 'Bend and balance; correct geometry; engagement.', coefficient: 1 },
        { num: 3, name: 'K Leg-yield left, K to X. X Circle left 10m.', directive: 'Alignment nearly parallel to long side; clear crossing; rhythm maintained.', coefficient: 1 },
        { num: 4, name: 'X Leg-yield right, X to H.', directive: 'Consistent angle and bend; forehand slightly leading; regularity.', coefficient: 1 },
        { num: 5, name: 'M–X–K Change rein, lengthen stride in trot.', directive: 'Clear lengthening of stride and frame; balanced transitions at the markers.', coefficient: 2 },
        { num: 6, name: 'Between A & F Medium walk. F–E Change rein, free walk. E Medium walk.', directive: 'Regularity; freedom of the back and shoulder; complete stretch; ground cover.', coefficient: 2 },
        { num: 7, name: 'Before H Shorten the reins. H Working trot. Between C & M Working canter, right lead.', directive: 'Prompt, uphill transitions; correct lead; fluent sequence.', coefficient: 1 },
        { num: 8, name: 'B Circle right 15m, working canter.', directive: 'Quality of canter; geometry; uphill tendency.', coefficient: 1 },
        { num: 9, name: 'F–X–H Change rein, lengthen stride in canter. Before H Working canter.', directive: 'Ground cover with balance; smooth, engaged transitions.', coefficient: 1 },
        { num: 10, name: 'H–X Half diagonal, X Working trot. Between X & B Working canter, left lead.', directive: 'Balance through the simple change of lead through trot; correct new lead.', coefficient: 1 },
        { num: 11, name: 'E Single loop E–X–E in counter-canter, returning to the track.', directive: 'Quality and balance of counter-canter; alignment through the loop.', coefficient: 1 },
        { num: 12, name: 'K–X–M Change rein, lengthen stride in canter. Before M Working canter.', directive: 'Clear lengthening; straightness; balance in both transitions.', coefficient: 1 },
        { num: 13, name: 'Between C & H Working trot.', directive: 'Balanced, fluid downward transition; rhythm maintained.', coefficient: 1 },
        { num: 14, name: 'A Down centerline. X Halt, salute.', directive: 'Balance in the turn onto centerline; straightness; square, immobile halt.', coefficient: 1 }
      ]
    },

    {
      id: 'first-3',
      name: 'First Level Test 3',
      shortName: 'First 3',
      level: 'First',
      arena: 'standard',
      purpose: 'To confirm all First Level requirements: leg-yields, 10m circles, counter-canter loops, and lengthenings ridden with self-carriage and throughness.',
      movements: [
        { num: 1, name: 'A Enter working trot. X Halt, salute. Proceed working trot.', directive: 'Engagement into the halt; straightness; immobility.', coefficient: 1 },
        { num: 2, name: 'C Track left. H–X–F Change rein, lengthen stride in trot.', directive: 'Clear lengthening of stride and frame; uphill balance; rhythm.', coefficient: 1 },
        { num: 3, name: 'A Down centerline. D Leg-yield right, D to E.', directive: 'Alignment; consistent crossing; tempo maintained.', coefficient: 2 },
        { num: 4, name: 'E Circle left 10m. Between E & H Working trot sitting.', directive: 'Bend and geometry; engagement; suppleness of the back.', coefficient: 1 },
        { num: 5, name: 'C Down centerline. G Leg-yield left, G to B.', directive: 'Parallel alignment; clarity of crossing; balance.', coefficient: 2 },
        { num: 6, name: 'Between B & F Medium walk. F–X Half diagonal, free walk. X–H Free walk.', directive: 'Regularity; complete freedom to stretch; ground cover; relaxation.', coefficient: 2 },
        { num: 7, name: 'H Working trot. Between C & M Working canter, right lead.', directive: 'Prompt retake of contact; uphill strike-off; correct lead.', coefficient: 1 },
        { num: 8, name: 'B Circle right 10m, working canter.', directive: 'Quality of canter on the small circle; bend and balance.', coefficient: 1 },
        { num: 9, name: 'F–X–H Change rein, lengthen stride in canter. Before H Working canter.', directive: 'Clear lengthening with balance; smooth transitions.', coefficient: 1 },
        { num: 10, name: 'H–X Half diagonal, X Working trot, then between X & B Working canter, left lead.', directive: 'Balance in the simple change through trot; correct new lead; fluency.', coefficient: 1 },
        { num: 11, name: 'E Circle left 10m, working canter.', directive: 'Engagement and balance on the small circle; correct geometry.', coefficient: 1 },
        { num: 12, name: 'K–X–M Change rein, lengthen stride in canter. Before M Working canter.', directive: 'Ground cover; straightness; balanced transitions.', coefficient: 1 },
        { num: 13, name: 'Between C & H Working trot. E Turn left, B Track right.', directive: 'Balanced downward transition; accurate turns; bend through the turns.', coefficient: 1 },
        { num: 14, name: 'A Down centerline. X Halt, salute.', directive: 'Straightness on centerline; engaged, square, immobile halt.', coefficient: 1 }
      ]
    },

    // ---------------- The house special ----------------
    {
      id: 'pixel-freestyle',
      name: 'Pixel Freestyle (Musical Ride of Legend)',
      shortName: 'Pixel Freestyle',
      level: 'Freestyle',
      arena: 'standard',
      purpose: 'A just-for-fun musical freestyle: required elements ridden in any order to 8-bit music of your choosing. Artistic sparkle encouraged. Chiptune optional but advised.',
      movements: [
        { num: 1, name: 'Entry & halt-salute anywhere on centerline (A–X–C), boss-battle pose optional.', directive: 'Straightness; confidence; dramatic flair without loss of immobility.', coefficient: 1 },
        { num: 2, name: 'Working trot: a clearly recognizable 20m figure of your design.', directive: 'Rhythm with the music; correct, legible geometry.', coefficient: 1 },
        { num: 3, name: 'Free walk sequence, minimum 20m of unbroken stretch (the "power-up bar").', directive: 'Complete stretch; ground cover; relaxation; harmony with the music.', coefficient: 2 },
        { num: 4, name: 'Trot half circles onto and off the centerline (the "zig-zag warp pipe").', directive: 'Bend; balance; accuracy of the pattern.', coefficient: 1 },
        { num: 5, name: 'Leg-yield in trot, either direction, minimum quarterline to track.', directive: 'Alignment; clear crossing; rhythm maintained.', coefficient: 1 },
        { num: 6, name: 'Working canter, left lead: circle 15–20m ridden to the musical phrase.', directive: 'Correct lead; quality of canter; choreography matching the beat.', coefficient: 1 },
        { num: 7, name: 'Working canter, right lead: circle 15–20m ridden to the musical phrase.', directive: 'Correct lead; balance; use of arena space.', coefficient: 1 },
        { num: 8, name: 'Lengthening of stride in trot or canter on a diagonal (the "speed boost").', directive: 'Clear difference in stride; balanced transitions in and out.', coefficient: 2 },
        { num: 9, name: 'A movement of surprise: rider’s choice from any lower-level test ("secret level").', directive: 'Correctness of the chosen movement; imagination; degree of difficulty.', coefficient: 1 },
        { num: 10, name: 'Final centerline with halt-salute before C ("victory screen").', directive: 'Straightness; square, immobile halt; timing with the final chord.', coefficient: 1 },
        { num: 11, name: 'Artistic impression: music choice, interpretation & cohesion of the ride.', directive: 'Suitability of music; use of phrasing; overall harmony of the picture.', coefficient: 2 }
      ]
    }
  ];

  // ------------------------------------------------------------------
  // Collective marks (given after the final movement of every test)
  // ------------------------------------------------------------------
  const collectives = [
    { key: 'gaits',      name: 'Gaits',                       coefficient: 1, directive: 'Freedom and regularity.' },
    { key: 'impulsion',  name: 'Impulsion',                   coefficient: 1, directive: 'Desire to move forward; elasticity of the steps; suppleness of the back; engagement of the hindquarters.' },
    { key: 'submission', name: 'Submission',                  coefficient: 1, directive: 'Willing cooperation; harmony; attention and confidence; acceptance of bit and aids; straightness; lightness of forehand and ease of movements.' },
    { key: 'rider',      name: "Rider's Position & Seat",     coefficient: 1, directive: 'Alignment; posture; stability; weight placement; correct and effective use of the aids.' }
  ];

  // ------------------------------------------------------------------
  // Quick-note chips — judge shorthand, tap to append to a movement note
  // ------------------------------------------------------------------
  const quickNotes = {
    praise: [
      'fluid', 'obedient', 'uphill', 'supple', 'ground-covering', 'clear rhythm',
      'good stretch', 'square halt', 'prompt transition', 'steady contact',
      'nice bend', 'harmonious', 'active hind leg', 'good reach', 'well ridden'
    ],
    faults: [
      'above bit', 'behind vertical', 'haunches in', 'late behind', 'braced',
      'irregular', 'hollow', 'wrong lead', 'broke gait', 'on forehand',
      'tense back', 'resistant in transition', 'tilting head', 'strung out',
      'against the hand', 'loss of rhythm'
    ],
    geometry: [
      '20m too small', '20m too large', 'off centerline', 'early transition',
      'late transition', 'egg-shaped circle', 'shallow corner', 'drifted on diagonal',
      'overshot centerline', 'not to the letter', 'loop too shallow',
      'halt not at X', 'circle drifted', 'wrong diagonal line'
    ]
  };

  // ------------------------------------------------------------------
  // Sample events — 60 days following 2026-08-17, across rings A/B/warmup/clinic
  // ------------------------------------------------------------------
  const events = [
    {
      id: 'evt-schooling-aug',
      title: 'Late Summer Schooling Show',
      date: '2026-08-22',
      start: '08:00',
      end: '13:00',
      ring: 'A',
      type: 'show',
      notes: 'Intro through Training. Braids optional, good attitudes mandatory. Coffee cart by the warmup.',
      entries: [
        { time: '08:00', rider: 'Maya Chen',        horse: 'Sir Trots-a-Lot',    testId: 'intro-a' },
        { time: '08:15', rider: 'Beth Okafor',      horse: 'Neigh Sayer',        testId: 'intro-b' },
        { time: '08:30', rider: 'Lily Vance',       horse: 'Hay Girl Hay',       testId: 'intro-c' },
        { time: '08:45', rider: 'Tom Bridle',       horse: 'Withers Together',   testId: 'training-1' },
        { time: '09:00', rider: 'Sofia Ramos',      horse: 'Canter Believe It',  testId: 'training-2' },
        { time: '09:15', rider: 'Grace Halloway',   horse: 'Piaffe Daddy',       testId: 'training-3' }
      ]
    },
    {
      id: 'evt-clinic-sep',
      title: 'Clinic: Riding Accurate Circles (with Ada Reinsworth)',
      date: '2026-09-02',
      start: '09:00',
      end: '16:00',
      ring: 'clinic',
      type: 'clinic',
      notes: 'Semi-private 45-min slots. Bring your geometry — auditors welcome, bring a chair and a snack.',
      entries: [
        { time: '09:00', rider: 'Maya Chen',      horse: 'Sir Trots-a-Lot',   testId: 'intro-c' },
        { time: '10:00', rider: 'Priya Natesan',  horse: 'Extended Warranty', testId: 'training-2' },
        { time: '11:00', rider: 'Tom Bridle',     horse: 'Withers Together',  testId: 'training-1' },
        { time: '13:00', rider: 'Dana Whitfield', horse: 'Bit of a Handful',  testId: 'first-1' }
      ]
    },
    {
      id: 'evt-lessons-sep-1',
      title: 'Lesson Block: Adult Ammy Evening',
      date: '2026-09-09',
      start: '17:00',
      end: '20:00',
      ring: 'B',
      type: 'lesson',
      notes: 'Three private lessons back-to-back. Ring B drags at 16:30 — do not lunge on the fresh footing, Kevin.',
      entries: [
        { time: '17:00', rider: 'Beth Okafor',   horse: 'Neigh Sayer',       testId: 'intro-b' },
        { time: '18:00', rider: 'Sofia Ramos',   horse: 'Canter Believe It', testId: 'training-2' },
        { time: '19:00', rider: 'Dana Whitfield', horse: 'Bit of a Handful', testId: 'first-2' }
      ]
    },
    {
      id: 'evt-fixture-warmup',
      title: 'Warmup Ring Open Schooling',
      date: '2026-09-13',
      start: '07:30',
      end: '11:30',
      ring: 'warmup',
      type: 'other',
      notes: 'Open flat schooling before the fall season. Ride at your own pace; right shoulder to right shoulder, please.',
      entries: [
        { time: '07:30', rider: 'Lily Vance',     horse: 'Hay Girl Hay',     testId: 'intro-c' },
        { time: '08:30', rider: 'Grace Halloway', horse: 'Piaffe Daddy',     testId: 'training-3' },
        { time: '09:30', rider: 'Priya Natesan',  horse: 'Extended Warranty', testId: 'training-2' }
      ]
    },
    {
      id: 'evt-pixel-prix',
      title: 'The Pixel Prix — Fall Championship Schooling Show',
      date: '2026-09-26',
      start: '08:00',
      end: '17:00',
      ring: 'A',
      type: 'show',
      notes: 'The big one. Ribbons through 8th place, high-point trophy, and the coveted Golden Horseshoe. Freestyles after lunch — bring speakers.',
      entries: [
        { time: '08:00', rider: 'Maya Chen',       horse: 'Sir Trots-a-Lot',    testId: 'intro-c' },
        { time: '08:20', rider: 'Beth Okafor',     horse: 'Neigh Sayer',        testId: 'intro-c' },
        { time: '08:40', rider: 'Tom Bridle',      horse: 'Withers Together',   testId: 'training-1' },
        { time: '09:00', rider: 'Sofia Ramos',     horse: 'Canter Believe It',  testId: 'training-3' },
        { time: '09:20', rider: 'Grace Halloway',  horse: 'Piaffe Daddy',       testId: 'training-3' },
        { time: '09:40', rider: 'Priya Natesan',   horse: 'Extended Warranty',  testId: 'first-1' },
        { time: '10:00', rider: 'Dana Whitfield',  horse: 'Bit of a Handful',   testId: 'first-3' },
        { time: '13:00', rider: 'Grace Halloway',  horse: 'Piaffe Daddy',       testId: 'pixel-freestyle' },
        { time: '13:20', rider: 'Dana Whitfield',  horse: 'Mare-y Poppins',     testId: 'pixel-freestyle' }
      ]
    },
    {
      id: 'evt-clinic-oct',
      title: 'Clinic: Transitions That Score (with Franz Halterman)',
      date: '2026-10-04',
      start: '09:00',
      end: '15:00',
      ring: 'clinic',
      type: 'clinic',
      notes: 'Focus on the half-halt and the humble trot-walk transition. Auditing free for barn members.',
      entries: [
        { time: '09:00', rider: 'Sofia Ramos',    horse: 'Canter Believe It', testId: 'training-3' },
        { time: '10:00', rider: 'Dana Whitfield', horse: 'Mare-y Poppins',    testId: 'first-2' },
        { time: '11:00', rider: 'Beth Okafor',    horse: 'Neigh Sayer',       testId: 'training-1' },
        { time: '13:00', rider: 'Lily Vance',     horse: 'Stirrup Trouble',   testId: 'intro-c' }
      ]
    },
    {
      id: 'evt-lessons-oct',
      title: 'Lesson Block: Junior Riders Saturday',
      date: '2026-10-10',
      start: '09:00',
      end: '12:00',
      ring: 'B',
      type: 'lesson',
      notes: 'Juniors in the morning while Ring A is set for the fix-a-test. Helmets, boots, and enthusiasm required.',
      entries: [
        { time: '09:00', rider: 'Maya Chen',   horse: 'Sir Trots-a-Lot', testId: 'intro-b' },
        { time: '10:00', rider: 'Lily Vance',  horse: 'Stirrup Trouble', testId: 'intro-c' },
        { time: '11:00', rider: 'Omar Fetlock', horse: 'Unstable Genius', testId: 'intro-a' }
      ]
    },
    {
      id: 'evt-fix-a-test',
      title: 'Fix-a-Test with Donna Shar',
      date: '2026-10-10',
      start: '13:00',
      end: '16:30',
      ring: 'A',
      type: 'show',
      notes: 'Ride your test, get judged, get coached, ride it again. The fastest way to find those free half-points.',
      entries: [
        { time: '13:00', rider: 'Tom Bridle',     horse: 'Withers Together',  testId: 'training-2' },
        { time: '13:45', rider: 'Priya Natesan',  horse: 'Extended Warranty', testId: 'first-1' },
        { time: '14:30', rider: 'Grace Halloway', horse: 'Piaffe Daddy',      testId: 'first-1' },
        { time: '15:15', rider: 'Dana Whitfield', horse: 'Mare-y Poppins',    testId: 'first-3' }
      ]
    },
    {
      id: 'evt-warmup-pace',
      title: 'Warmup Ring: Musical Freestyle Practice Night',
      date: '2026-10-15',
      start: '17:30',
      end: '20:00',
      ring: 'warmup',
      type: 'other',
      notes: 'Speakers allowed, judgment suspended. Come test your freestyle choreography before the Halloween Pixel Prix II.',
      entries: [
        { time: '17:30', rider: 'Grace Halloway', horse: 'Piaffe Daddy',   testId: 'pixel-freestyle' },
        { time: '18:15', rider: 'Dana Whitfield', horse: 'Mare-y Poppins', testId: 'pixel-freestyle' },
        { time: '19:00', rider: 'Omar Fetlock',   horse: 'Unstable Genius', testId: 'pixel-freestyle' }
      ]
    }
  ];

  return { tests: tests, events: events, quickNotes: quickNotes, collectives: collectives };
}));
