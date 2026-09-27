import type { LearningItem, Lesson } from './types'
import {rubricFor} from './practiceGrading'

const teachingItems: Omit<LearningItem,'practice'|'instructions'>[] = [
  {id:'open',lessonId:'foundations',name:'Open hand',description:'Build control for signs that use a flat or open hand.',animationId:'hello',components:{handshape:'Four fingers extended',focus:'Comfortably straight fingers'},validationStatus:'illustrative'},
  {id:'fist',lessonId:'foundations',name:'Closed hand',description:'Practice a relaxed closed hand without excess tension.',animationId:'yes',components:{handshape:'Four fingers curled',focus:'Relaxed, even curl'},validationStatus:'illustrative'},
  {id:'index',lessonId:'foundations',name:'Index extension',description:'Isolate the index finger while the other fingers remain curled.',animationId:'question',components:{handshape:'Index finger extended',focus:'Independent finger control'},validationStatus:'illustrative'},
  {id:'two-open',lessonId:'foundations',name:'Two-hand coordination',description:'Keep two open handshapes visible at the same time.',animationId:'two_open',components:{handshape:'Two open hands',position:'Hands raised to either side',movement:'Extend up and outward',orientation:'Open palms facing forward',focus:'Symmetry and visibility'},validationStatus:'illustrative'},

  {id:'hello',lessonId:'greetings',name:'Hello',description:'A common greeting used to begin a conversation.',animationId:'hello',components:{handshape:'Open hand',position:'Near the forehead',movement:'Move outward',orientation:'Palm facing outward'},validationStatus:'unverified'},
  {id:'thank_you',lessonId:'greetings',name:'Thank you',description:'A polite expression of appreciation.',animationId:'thank_you',components:{handshape:'Open hand',position:'Near the chin',movement:'Move straight down from the chin',orientation:'Palm toward the face'},validationStatus:'unverified'},
  {id:'please',lessonId:'greetings',name:'Please',description:'A polite expression used when making a request.',animationId:'please',components:{handshape:'Flat open hand',position:'At the chest',movement:'Small circular motion',orientation:'Palm toward the body'},validationStatus:'unverified'},

  {id:'name',lessonId:'introductions',name:'Name',description:'Used when sharing or asking for a name.',animationId:'name',components:{handshape:'Two H-like handshapes',position:'In front of the body',movement:'Repeated contact'},validationStatus:'unverified'},
  {id:'me',lessonId:'introductions',name:'Me',description:'Points to the signer as a participant.',animationId:'me',components:{handshape:'Index finger extended',position:'Toward the chest',movement:'Short inward point'},validationStatus:'unverified'},
  {id:'you',lessonId:'introductions',name:'You',description:'Points toward the person being addressed.',animationId:'you',components:{handshape:'Index finger extended',position:'In neutral signing space',movement:'Point outward'},validationStatus:'unverified'},

  {id:'help',lessonId:'classroom',name:'Help',description:'A useful classroom request for assistance.',animationId:'help',components:{handshape:'Closed dominant hand over open support hand',position:'In front of the torso',movement:'Thumb-up fist taps the support palm twice'},validationStatus:'unverified'},
  {id:'again',lessonId:'classroom',name:'Again',description:'Requests repetition or indicates another occurrence.',animationId:'again',components:{handshape:'Two different handshapes',position:'In front of the body',movement:'Curved movement toward the support hand'},validationStatus:'unverified'},
  {id:'understand',lessonId:'classroom',name:'Understand',description:'Expresses comprehension in a classroom exchange.',animationId:'understand',components:{handshape:'Index finger extended at the end',position:'Near the forehead',movement:'Index finger opens upward'},validationStatus:'unverified'},
  {id:'question',lessonId:'classroom',name:'Question',description:'Introduces or refers to a question.',animationId:'question',components:{handshape:'Index finger extended',position:'Raised beside the head',movement:'Curl and extend the index twice',orientation:'Palm facing forward'},validationStatus:'unverified'},
]

// The rubric is the source of both instructions and grading, so the displayed
// requirements cannot silently diverge from the checks used for completion.
export const LEARNING_ITEMS: LearningItem[] = teachingItems.map(item=>{
  const rubric=rubricFor(item.id)
  return {...item,instructions:rubric?.steps.map(step=>step.label)??[],
    practice:{enabled:!!rubric,mode:item.lessonId==='foundations'?'handshape':'full-sign',scopeLabel:item.lessonId==='foundations'?'Sustained handshape practice':'Shape, position, and movement sequence'}}
})

export const LESSONS: Lesson[] = [
  {id:'foundations',title:'Foundations',subtitle:'Warm-up handshapes',items:['open','fist','index','two-open']},
  {id:'greetings',title:'Greetings',subtitle:'Lesson 1',items:['hello','thank_you','please']},
  {id:'introductions',title:'Introductions',subtitle:'Lesson 2',items:['name','me','you']},
  {id:'classroom',title:'Classroom Basics',subtitle:'Lesson 3',items:['help','again','understand','question']},
]

export const learningItem = (id:string) => LEARNING_ITEMS.find(item=>item.id===id) ?? LEARNING_ITEMS[0]
