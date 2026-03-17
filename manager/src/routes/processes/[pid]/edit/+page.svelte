<script lang="ts">
  export let data;
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
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
  //import { createLogger } from 'vite';
  //const log = createLogger();
  const showNewStep = data.status === 'done';
  let newSeeds: string;
  let predLimitations: { predicate: string; past: string; future: string }[] = [
    { predicate: '', past: '', future: '' }
  ];
  let maxPathLength: number = data.currentStep.maxPathLength;
  let maxPathProps: number = data.currentStep.maxPathProps;
  let followDirection: boolean = data.currentStep.followDirection;

  function addPredLimitation() {
    predLimitations = [...predLimitations, { predicate: '', past: '', future: '' }];
  }

  function removePredLimitation(index: number) {
    predLimitations = predLimitations.filter((_, i) => i !== index);
  }

  async function addStep() {
    const ns = newSeeds?.split(/\s*[\n,]\s*/).filter((s: string) => !s.match(/^\s*$/));

    const filteredLimitations = predLimitations.filter((pl) => pl.predicate.trim());

    try {
      await fetch(`/api/processes/${data.pid}/add-step`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          maxPathLength,
          maxPathProps,
          newSeeds: ns,
          predLimitations: filteredLimitations
        })
      });

      // new step created
      goto(`/processes/${data.pid}`);
    } catch (e) {
      //log.error('Error adding new step' + e);
      goto(`/processes/${data.pid}`);
    }
  }
</script>

<Container>
  <header style="padding-bottom: 1rem">
    <h2>Edit crawling process</h2>
  </header>

  <Container>
    <Row>
      <Col>
        <Accordion>
          <AccordionItem header="Add new crawling step" active>
            {#if showNewStep}
              <!-- form
								id="new-crawl-step"
								action="/processes/{data.pid}?/addStep"
								method="POST"
								use:enhance={() => {
									return ({ update }) => update({ reset: false });
								}}
							-->
              <FormGroup>
                <Row>
                  <Col sm={2}>
                    <Label>Additional seeds:</Label>
                  </Col>
                  <Col sm={10}>
                    <InputGroup>
                      <Input
                        id="seeds"
                        name="seeds"
                        type="textarea"
                        bind:value={newSeeds}
                        rows={3}
                        form="new-crawl-step"
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
                        bind:value={maxPathLength}
                        type="number"
                        name="maxPathLength"
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
                        bind:value={maxPathProps}
                        type="number"
                        name="maxPathProps"
                      />
                    </InputGroup>
                  </Col>
                </Row>
              </FormGroup>

              <FormGroup>
                <Row>
                  <Col sm={12}>
                    <Label>Predicate Limitations:</Label>
                    <Tooltip target="pred-limit-tt"
                      >Configure which predicates are required or disallowed in paths</Tooltip
                    >
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

              <FormGroup>
                <Row>
                  <Col sm={2}>
                    <Label for="follow-direction">Follow direction:</Label>
                  </Col>
                  <Col sm={10}>
                    <Input
                      id="follow-direction"
                      name="followDirection"
                      bind:checked={followDirection}
                      type="checkbox"
                    />
                  </Col>
                </Row>
              </FormGroup>

              <FormGroup>
                <Col sm={10}>
                  <Button color="primary" on:click={addStep} type="button">Add new step</Button>
                </Col>
              </FormGroup>
              <!-- /form -->
            {:else}
              <p>
                Current step is not done yet, you need to wait for it to finish before adding more
                steps.
              </p>
            {/if}
          </AccordionItem>
          <AccordionItem header="Edit other settings">
            <form
              id="edit-proc"
              method="POST"
              use:enhance={() => {
                return ({ update }) => update({ reset: false });
              }}
            >
              <FormGroup>
                <Row>
                  <Col sm={1}>
                    <Label>Email:</Label>
                  </Col>
                  <Col sm={{ size: 6, offset: 1 }}>
                    <InputGroup>
                      <Input name="email" placeholder={data.notification.email} />
                      <Tooltip target="email-tt"
                        >We'll only send you 3 emails: confirming your process has been added; when
                        your process starts; and when your process finishes. No SPAM</Tooltip
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
                      <Input name="webhook" />
                      <Tooltip target="webhook-tt"
                        >An HTTP callback which can be used to send notifications when the status of
                        this process changes.</Tooltip
                      >
                      <InputGroupText id="webhook-tt">?</InputGroupText>
                    </InputGroup>
                  </Col>
                </Row>
              </FormGroup>
              <FormGroup>
                <Col sm={10}>
                  <Button color="primary" type="submit">Save</Button>
                </Col>
              </FormGroup>
            </form>
          </AccordionItem>
        </Accordion>
      </Col>
    </Row>
  </Container>
</Container>
