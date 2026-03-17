<script lang="ts">
  import { applyAction, deserialize, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { ActionResult } from '@sveltejs/kit';
  import {
    Container,
    Row,
    Col,
    InputGroup,
    Accordion,
    Button,
    Tooltip,
    FormGroup,
    AccordionItem,
    Label,
    Input,
    InputGroupText
  } from '@sveltestrap/sveltestrap';
  let resources = '';
  let maxPathLength = 3;
  let maxPathProps = 2;
  let email = '';
  let webhook = '';
  let predLimitations: { predicate: string; past: string; future: string }[] = [
    { predicate: '', past: '', future: '' }
  ];

  function addPredLimitation() {
    predLimitations = [...predLimitations, { predicate: '', past: '', future: '' }];
  }

  function removePredLimitation(index: number) {
    predLimitations = predLimitations.filter((_, i) => i !== index);
  }

  async function handleSubmit(
    event: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement }
  ) {
    event.preventDefault();

    // build form data from variables
    const formData = new FormData();
    formData.append('seeds', resources);
    formData.append('maxPathLength', maxPathLength.toString());
    formData.append('maxPathProps', maxPathProps.toString());
    formData.append('email', email);
    formData.append('webhook', webhook);

    // Add predLimitations
    predLimitations.forEach((pl, index) => {
      if (pl.predicate.trim()) {
        formData.append(`predLimitations[${index}].predicate`, pl.predicate);
        formData.append(`predLimitations[${index}].past`, pl.past);
        formData.append(`predLimitations[${index}].future`, pl.future);
      }
    });

    const response = await fetch(event.currentTarget.action, {
      method: 'POST',
      body: formData
    });

    const result: ActionResult = deserialize(await response.text());
    if (result.type === 'success') {
      await invalidateAll();
    }
    applyAction(result);
  }
</script>

<Container>
  <header style="padding-bottom: 1rem">
    <h2>Add new crawling process</h2>
  </header>

  <Container>
    <Row>
      <Col>
        <form
          id="new-proc"
          action="/processes?/newProc"
          onsubmit={handleSubmit}
          use:enhance={() => {
            return ({ update }) => update({ reset: false });
          }}
        >
          <FormGroup>
            <Accordion>
              <AccordionItem active header="General information">
                <FormGroup>
                  <Row>
                    <Col sm={2}>
                      <Label>Resources:</Label>
                    </Col>
                    <Col sm={10}>
                      <InputGroup>
                        <Input
                          id="seeds"
                          name="seeds"
                          type="textarea"
                          rows={3}
                          form="new-proc"
                          bind:value={resources}
                        />
                        <Tooltip target="resources-tt">One resource URL per line</Tooltip>
                        <InputGroupText id="resources-tt">?</InputGroupText>
                      </InputGroup>
                    </Col>
                  </Row>
                </FormGroup>

                <FormGroup>
                  <Row>
                    <Col sm={2}>
                      <Label>Max length:</Label>
                    </Col>
                    <Col sm={2}>
                      <InputGroup>
                        <Input
                          min="1"
                          max="20"
                          step="1"
                          type="number"
                          name="maxPathLength"
                          bind:value={maxPathLength}
                        />
                      </InputGroup>
                    </Col>
                  </Row>
                </FormGroup>

                <FormGroup>
                  <Row>
                    <Col sm={2}>
                      <Label>Max props:</Label>
                    </Col>
                    <Col sm={2}>
                      <InputGroup>
                        <Input
                          min="1"
                          max="5"
                          step="1"
                          type="number"
                          name="maxPathProps"
                          bind:value={maxPathProps}
                        />
                      </InputGroup>
                    </Col>
                  </Row>
                </FormGroup>
              </AccordionItem>
              <AccordionItem header="Notification options">
                <FormGroup>
                  <Row>
                    <Col sm={1}>
                      <Label>Email:</Label>
                    </Col>
                    <Col sm={{ size: 6, offset: 1 }}>
                      <InputGroup>
                        <Input name="email" bind:value={email} />
                        <Tooltip target="email-tt"
                          >We'll only send you 3 emails: confirming your process has been added;
                          when your process starts; and when your process finishes. No SPAM</Tooltip
                        >
                        <InputGroupText id="email-tt">?</InputGroupText>
                      </InputGroup>
                    </Col>
                  </Row>
                </FormGroup>
                <FormGroup>
                  <Row>
                    <Col sm={1}>
                      <Label>Webhook:</Label>
                    </Col>
                    <Col sm={{ size: 6, offset: 1 }}>
                      <InputGroup>
                        <Input name="webhook" bind:value={webhook} />
                        <Tooltip target="webhook-tt"
                          >An HTTP callback which can be used to send notifications when the status
                          of this process changes.</Tooltip
                        >
                        <InputGroupText id="webhook-tt">?</InputGroupText>
                      </InputGroup>
                    </Col>
                  </Row>
                </FormGroup>
              </AccordionItem>
              <AccordionItem header="Limit predicates">
                <FormGroup>
                  <Row>
                    <Col sm={12}>
                      <Label>Predicate Limitations:</Label>
                      <Tooltip target="pred-limit-tt"
                        >Configure which predicates are required or disallowed in paths</Tooltip
                      >
                      <InputGroup>
                        <InputGroupText id="pred-limit-tt" style="width: 30px; text-align: center">?</InputGroupText>
                      </InputGroup>
                    </Col>
                  </Row>
                </FormGroup>

                {#each predLimitations as pl, index}
                  <FormGroup>
                    <Row class="mb-2">
                      <Col sm={5}>
                        <Input
                          type="text"
                          placeholder="Predicate URL (e.g., http://xmlns.com/foaf/0.1/name)"
                          bind:value={pl.predicate}
                        />
                      </Col>
                      <Col sm={3}>
                        <Input type="select" bind:value={pl.past}>
                          <option value="">Past: (none)</option>
                          <option value="require">Past: Require</option>
                          <option value="disallow">Past: Disallow</option>
                        </Input>
                      </Col>
                      <Col sm={3}>
                        <Input type="select" bind:value={pl.future}>
                          <option value="">Future: (none)</option>
                          <option value="require">Future: Require</option>
                          <option value="disallow">Future: Disallow</option>
                        </Input>
                      </Col>
                      <Col sm={1}>
                        <Button color="danger" size="sm" on:click={() => removePredLimitation(index)}>
                          &times;
                        </Button>
                      </Col>
                    </Row>
                  </FormGroup>
                {/each}

                <FormGroup>
                  <Row>
                    <Col sm={12}>
                      <Button color="secondary" size="sm" on:click={addPredLimitation}>
                        + Add Predicate Limitation
                      </Button>
                    </Col>
                  </Row>
                </FormGroup>
              </AccordionItem>
            </Accordion>
          </FormGroup>

          <FormGroup>
            <Col sm={10}>
              <Button id="form-submit" color="primary" type="submit">Submit</Button>
            </Col>
          </FormGroup>
        </form>
      </Col>
    </Row>
  </Container>
</Container>
