import crypto from "node:crypto";
const id=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();
const clean=(v,n=160)=>String(v??"").trim().slice(0,n);
const fail=(res,status,message)=>res.status(status).json({success:false,message});

export function registerInstitutionLibrary({app,database,requireAuth,requireMfaProduction,enforceSameOrigin,getInstitutionMembership,hasInstitutionFeature}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS institution_library_books(
      id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      accession_number TEXT NOT NULL,title TEXT NOT NULL,author TEXT NOT NULL,isbn TEXT,category TEXT,
      total_copies INTEGER NOT NULL CHECK(total_copies>=0),available_copies INTEGER NOT NULL CHECK(available_copies>=0 AND available_copies<=total_copies),
      shelf_location TEXT,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','withdrawn')),
      created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(institution_id,accession_number)
    );
    CREATE TABLE IF NOT EXISTS institution_library_loans(
      id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES institution_library_books(id),student_user_id TEXT NOT NULL REFERENCES users(id),
      issued_by TEXT NOT NULL REFERENCES users(id),issued_at TEXT NOT NULL,due_at TEXT NOT NULL,
      returned_at TEXT,status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','returned','lost')),
      fine_paise INTEGER NOT NULL DEFAULT 0 CHECK(fine_paise>=0),fine_status TEXT NOT NULL DEFAULT 'none' CHECK(fine_status IN ('none','due','paid','waived')),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_library_loans_student ON institution_library_loans(institution_id,student_user_id,status);
    CREATE TABLE IF NOT EXISTS institution_library_reservations(
      id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      book_id TEXT NOT NULL REFERENCES institution_library_books(id),student_user_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','fulfilled','cancelled')),
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS institution_library_audit(
      id TEXT PRIMARY KEY,institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,entity_id TEXT,details_json TEXT NOT NULL,created_at TEXT NOT NULL
    );
  `);
  function member(req,res,i,roles) {
    const m=getInstitutionMembership(req.user.id,i);
    if(!m||m.status!=="active"||!roles.includes(m.role)){fail(res,403,"Your institution role does not allow this library action.");return null;}
    if(!hasInstitutionFeature(i,"library")){fail(res,403,"Library module is not enabled for this institution.");return null;}
    return m;
  }
  function audit(i,u,action,entity,details={}) {
    database.prepare("INSERT INTO institution_library_audit(id,institution_id,actor_user_id,action,entity_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)").run(id(),i,u,action,entity||null,JSON.stringify(details),now());
  }
  app.get("/api/institutions/:institutionId/library",requireAuth,requireMfaProduction,(req,res,next)=>{
    try {
      const i=clean(req.params.institutionId,128),m=member(req,res,i,["institution_admin","reviewer","read_only","student"]);if(!m)return;
      const books=database.prepare(`SELECT b.id,b.accession_number AS accessionNumber,b.title,b.author,b.isbn,b.category,b.total_copies AS totalCopies,b.available_copies AS availableCopies,b.shelf_location AS shelfLocation,b.status FROM institution_library_books b WHERE b.institution_id=? ORDER BY b.title COLLATE NOCASE LIMIT 1000`).all(i);
      const loans=database.prepare(`SELECT l.id,l.book_id AS bookId,b.title,b.accession_number AS accessionNumber,l.student_user_id AS studentUserId,u.email AS studentEmail,l.issued_at AS issuedAt,l.due_at AS dueAt,l.returned_at AS returnedAt,l.status,l.fine_paise AS finePaise,l.fine_status AS fineStatus FROM institution_library_loans l JOIN institution_library_books b ON b.id=l.book_id JOIN users u ON u.id=l.student_user_id WHERE l.institution_id=? AND l.status='issued' ${m.role==="student"?"AND l.student_user_id=?":""} ORDER BY l.due_at`).all(...(m.role==="student"?[i,req.user.id]:[i]));
      const reservations=database.prepare("SELECT id,book_id AS bookId,student_user_id AS studentUserId,status,created_at AS createdAt FROM institution_library_reservations WHERE institution_id=? AND status='waiting' AND student_user_id=? ORDER BY created_at").all(i,req.user.id);
      res.setHeader("Cache-Control","private, no-store");return res.json({success:true,books,loans,reservations});
    }catch(e){next(e);}
  });
  app.post("/api/institutions/:institutionId/library/books",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const i=clean(req.params.institutionId,128);if(!member(req,res,i,["institution_admin"]))return;
      const accession=clean(req.body?.accessionNumber,60),title=clean(req.body?.title,180),author=clean(req.body?.author,140),isbn=clean(req.body?.isbn,30),category=clean(req.body?.category,80),shelf=clean(req.body?.shelfLocation,80),copies=Number(req.body?.totalCopies);
      if(accession.length<2||title.length<2||author.length<2||!Number.isSafeInteger(copies)||copies<1||copies>100000)return fail(res,400,"Enter a valid accession number, title, author and copy count.");
      const bookId=id(),ts=now();
      const inserted=database.prepare("INSERT OR IGNORE INTO institution_library_books(id,institution_id,accession_number,title,author,isbn,category,total_copies,available_copies,shelf_location,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(bookId,i,accession,title,author,isbn||null,category||null,copies,copies,shelf||null,req.user.id,ts,ts);
      if(!inserted.changes)return fail(res,409,"This accession number already exists.");
      audit(i,req.user.id,"book_created",bookId,{accession,title,copies});return res.status(201).json({success:true,book:{id:bookId,accessionNumber:accession,title,author,totalCopies:copies,availableCopies:copies}});
    }catch(e){next(e);}
  });
  app.patch("/api/institutions/:institutionId/library/books/:bookId",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const i=clean(req.params.institutionId,128),bookId=clean(req.params.bookId,128);if(!member(req,res,i,["institution_admin"]))return;
      const book=database.prepare("SELECT total_copies,available_copies,status FROM institution_library_books WHERE id=? AND institution_id=?").get(bookId,i);if(!book)return fail(res,404,"Book not found.");
      const title=clean(req.body?.title,180),author=clean(req.body?.author,140),shelf=clean(req.body?.shelfLocation,80),status=clean(req.body?.status,20);
      if(title.length<2||author.length<2||!["active","withdrawn"].includes(status))return fail(res,400,"Enter valid book details and status.");
      if(status==="withdrawn"&&Number(book.total_copies)!==Number(book.available_copies))return fail(res,409,"Return or reconcile every issued copy before withdrawing this title.");
      database.prepare("UPDATE institution_library_books SET title=?,author=?,shelf_location=?,status=?,updated_at=? WHERE id=? AND institution_id=?").run(title,author,shelf,status,now(),bookId,i);
      audit(i,req.user.id,"book_updated",bookId,{title,author,shelf,status});return res.json({success:true});
    }catch(e){next(e);}
  });
  app.post("/api/institutions/:institutionId/library/loans",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const i=clean(req.params.institutionId,128);if(!member(req,res,i,["institution_admin","reviewer"]))return;
      const bookId=clean(req.body?.bookId,128),studentId=clean(req.body?.studentUserId,128),days=Number(req.body?.loanDays??14);
      if(!Number.isSafeInteger(days)||days<1||days>90)return fail(res,400,"Loan period must be between 1 and 90 days.");
      const student=database.prepare("SELECT 1 FROM institution_memberships WHERE institution_id=? AND user_id=? AND role='student' AND status='active'").get(i,studentId);if(!student)return fail(res,404,"Active student membership not found.");
      const book=database.prepare("SELECT id,title,available_copies,status FROM institution_library_books WHERE id=? AND institution_id=?").get(bookId,i);if(!book)return fail(res,404,"Book not found.");
      if(book.status!=="active")return fail(res,409,"This title is withdrawn.");
      const outstanding=database.prepare("SELECT COUNT(*) AS n FROM institution_library_loans WHERE institution_id=? AND student_user_id=? AND status='issued'").get(i,studentId).n;
      if(Number(outstanding)>=10)return fail(res,409,"Student has reached the active loan limit.");
      const loanId=id(),issued=now(),due=new Date(Date.now()+days*86400000).toISOString();
      database.exec("BEGIN IMMEDIATE");
      try{
        const changed=database.prepare("UPDATE institution_library_books SET available_copies=available_copies-1,updated_at=? WHERE id=? AND institution_id=? AND available_copies>0 AND status='active'").run(issued,bookId,i);
        if(!changed.changes){database.exec("ROLLBACK");return fail(res,409,"No available copy remains.");}
        database.prepare("INSERT INTO institution_library_loans(id,institution_id,book_id,student_user_id,issued_by,issued_at,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(loanId,i,bookId,studentId,req.user.id,issued,due,issued,issued);
        audit(i,req.user.id,"book_issued",loanId,{bookId,studentId,dueAt:due});database.exec("COMMIT");
      }catch(e){try{database.exec("ROLLBACK");}catch{}throw e;}
      return res.status(201).json({success:true,loan:{id:loanId,bookId,studentUserId:studentId,issuedAt:issued,dueAt:due,status:"issued"}});
    }catch(e){next(e);}
  });
  app.post("/api/institutions/:institutionId/library/loans/:loanId/return",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const i=clean(req.params.institutionId,128),loanId=clean(req.params.loanId,128);if(!member(req,res,i,["institution_admin","reviewer"]))return;
      const loan=database.prepare("SELECT id,book_id AS bookId,due_at AS dueAt,status FROM institution_library_loans WHERE id=? AND institution_id=?").get(loanId,i);if(!loan)return fail(res,404,"Loan not found.");
      if(loan.status!=="issued")return fail(res,409,"This loan has already been closed.");
      const ts=now(),lateDays=Math.max(0,Math.ceil((Date.now()-Date.parse(loan.dueAt))/86400000)),fine=Math.min(lateDays*5000,500000);
      database.exec("BEGIN IMMEDIATE");
      try{
        const changed=database.prepare("UPDATE institution_library_loans SET status='returned',returned_at=?,fine_paise=?,fine_status=?,updated_at=? WHERE id=? AND institution_id=? AND status='issued'").run(ts,fine,fine>0?"due":"none",ts,loanId,i);
        if(!changed.changes){database.exec("ROLLBACK");return fail(res,409,"Loan was already returned.");}
        database.prepare("UPDATE institution_library_books SET available_copies=MIN(total_copies,available_copies+1),updated_at=? WHERE id=? AND institution_id=?").run(ts,loan.bookId,i);
        audit(i,req.user.id,"book_returned",loanId,{finePaise:fine,lateDays});database.exec("COMMIT");
      }catch(e){try{database.exec("ROLLBACK");}catch{}throw e;}
      return res.json({success:true,returnedAt:ts,finePaise:fine,fineStatus:fine>0?"due":"none"});
    }catch(e){next(e);}
  });
  app.post("/api/institutions/:institutionId/library/reservations",enforceSameOrigin,requireAuth,requireMfaProduction,(req,res,next)=>{
    try{
      const i=clean(req.params.institutionId,128);if(!member(req,res,i,["student"]))return;
      const bookId=clean(req.body?.bookId,128),book=database.prepare("SELECT id,status,available_copies FROM institution_library_books WHERE id=? AND institution_id=?").get(bookId,i);
      if(!book||book.status!=="active")return fail(res,404,"Available library title not found.");
      if(Number(book.available_copies)>0)return fail(res,409,"A copy is available now; request an issue from the library counter.");
      const exists=database.prepare("SELECT id FROM institution_library_reservations WHERE institution_id=? AND book_id=? AND student_user_id=? AND status='waiting'").get(i,bookId,req.user.id);if(exists)return fail(res,409,"You already have an active reservation for this title.");
      const reservationId=id(),ts=now();database.prepare("INSERT INTO institution_library_reservations(id,institution_id,book_id,student_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(reservationId,i,bookId,req.user.id,ts,ts);
      audit(i,req.user.id,"book_reserved",reservationId,{bookId});return res.status(201).json({success:true,reservation:{id:reservationId,bookId,status:"waiting"}});
    }catch(e){next(e);}
  });
}
