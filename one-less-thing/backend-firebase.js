// Firebase data layer for One Less Thing!
// Teachers are signed in anonymously (no login screen). The admin signs in
// with Google through the hidden lock button. firestore.rules decides who can
// read and write what.
const V = "10.12.2";
const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
const A = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`);
const F = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

export function create(config){
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const live = (q, next, err) => F.onSnapshot(q, next, err);

  return {
    onAuth(cb){
      return A.onAuthStateChanged(auth, u => {
        if(!u){ A.signInAnonymously(auth).catch(e=>{ console.error(e); cb(null); }); return; }
        cb({ uid:u.uid, isAnonymous:u.isAnonymous, email:u.email||"" });
      });
    },
    async signInAdmin(){
      const p = new A.GoogleAuthProvider();
      p.setCustomParameters({ prompt:"select_account" });
      await A.signInWithPopup(auth, p);
    },
    signOut(){ return A.signOut(auth); },
    // Only an admin can list the responses collection, so this asks the server.
    async checkAdmin(){
      try{ await F.getDocs(F.query(F.collection(db,"responses"), F.limit(1))); return true; }
      catch(e){ if(e.code!=="permission-denied") console.error(e); return false; }
    },

    watchList(next, err){
      return live(F.collection(db,"list"), s => next(s.docs.map(d=>({id:d.id, ...d.data()}))), err);
    },
    watchMine(uid, next, err){
      return live(F.doc(db,"responses",uid), s => next(s.exists() ? (s.data().items||[]) : []), err);
    },
    watchResponses(next, err){
      return live(F.collection(db,"responses"), s => next(s.docs.map(d=>d.data())), err);
    },
    watchTriage(next, err){
      return live(F.doc(db,"triage","state"), s => next(s.exists() ? (s.data().dismissed||[]) : []), err);
    },

    submit(uid, item){
      return F.setDoc(F.doc(db,"responses",uid), { items: F.arrayUnion(item) }, { merge:true });
    },
    addList(data){ return F.addDoc(F.collection(db,"list"), data); },
    updateList(id, patch){ return F.updateDoc(F.doc(db,"list",id), patch); },
    deleteList(id){ return F.deleteDoc(F.doc(db,"list",id)); },
    setTriage(dismissed){ return F.setDoc(F.doc(db,"triage","state"), { dismissed }); },
  };
}
